# Monitoring

Master spec §63 "Observability" lists six areas to implement: application
logging, error tracking, API monitoring, database monitoring, background
job monitoring, and payment monitoring — plus an explicit denylist of what
must never be logged (passwords, payment secrets, authentication tokens,
sensitive personal information unnecessarily). This document is the honest
status of each, as of Phase 16.

## Application logging — implemented

`lib/monitoring/logger.ts` exports a structured JSON logger (`log.debug` /
`.info` / `.warn` / `.error`), one JSON object per line, safe to pipe into
any log aggregator. It recursively redacts any object key matching a
sensitive-field pattern (password, secret, token, authorization header,
cookie, card/bank/government-ID-shaped fields) before serializing — see
that file's header and `tests/unit/monitoring/logger.test.ts` for the exact
coverage. This is now the only module in the codebase that calls
`console.*` directly.

Wired into: `lib/utils/api-error.ts`'s catch-all (every unhandled API
error), `NotificationService`'s email/SMS dispatch failures, and
`InventoryService.consumeForOrder`'s incompatible-unit-conversion guard —
the three places that previously either used a raw `console.error` or
silently swallowed an error with no trace at all.

## Error tracking — seam exists, not configured

`lib/monitoring/ErrorReporter.ts` — same provider-agnostic shape as every
other integration in this app (`Unconfigured*Provider` stub +
`get*Provider()` factory reading `ERROR_REPORTING_PROVIDER_KEY`). Unlike
every other `Unconfigured*Provider` in the codebase, this one is a
deliberate no-op rather than a throw — see that file's header for why
(throwing from inside error-handling code is worse than not reporting).
Wire in a real provider (Sentry, Rollbar, Bugsnag, ...) by adding a branch
to `getErrorReporter()`; no call site changes required.

Every error that would go to this provider is already captured by the
structured logger regardless of whether a provider is configured — this is
additive aggregation/alerting, not the only record.

## API monitoring — `/api/health` + your own request logs

`app/api/health/route.ts` is an unauthenticated liveness/readiness
endpoint — round-trips the database (`SELECT 1`) so a "healthy" response
means both the app process and its DB connection are good. Point an uptime
monitor and/or your load balancer's health check at it.

Beyond up/down, per-request metrics (latency percentiles, error rate by
route) are not separately instrumented in this phase — that's typically
provided by whatever hosting platform serves the app (most give you this
for free: Vercel Analytics, a reverse proxy's access logs, an APM agent)
rather than something this codebase should reimplement. If you need
custom route-level metrics, `middleware.ts` is the natural place to add
timing instrumentation later, since every `/api/*` request already passes
through it for rate limiting.

## Database monitoring — provider-native

Connection health is covered by `/api/health`. Deeper database metrics
(query performance, connection pool saturation, replication lag if
applicable) are a managed-Postgres-provider concern (§59: "Managed
PostgreSQL") — RDS/Cloud SQL/Neon/etc. all expose this natively. Nothing
provider-specific is wired into this codebase, consistent with §59's
provider-agnostic requirement.

## Background job monitoring — not applicable yet

This codebase has no background job queue/worker (see
`docs/architecture.md` for what's built) — every operation runs
synchronously within a request or a database transaction. If a real queue
(BullMQ, a managed queue service, etc.) is introduced in the future, this
section should be revisited to specify how job success/failure/retry gets
logged and alerted on, following the same `lib/monitoring/logger.ts`
pattern established here.

## Payment monitoring — via the existing provider seam

`lib/payments/PaymentProvider.ts` is unconfigured (no real payment
provider wired in — see that file). Once one is, payment-specific
monitoring (failed charges, webhook delivery failures) should log through
`lib/monitoring/logger.ts` the same way notification dispatch does today,
and must never log full card numbers, CVVs, or provider API secrets — the
logger's redaction pattern already strips fields matching those names, but
a real integration should still avoid ever holding raw card data in the
first place (tokenize at the provider, never pass raw PANs through this
app's own code).

## The "do not log" list — how it's enforced here

§63's denylist (passwords, payment secrets, authentication tokens,
unnecessary PII) is enforced by `lib/monitoring/logger.ts`'s `redact()`
function pattern-matching on object *keys*, applied recursively to every
`context` object passed to `log.*`. This is a best-effort denylist, not a
guarantee — callers should still pass specific, already-known-safe fields
as context rather than entire request bodies or full user/customer
records. See that file's header for the full reasoning and
`tests/unit/monitoring/logger.test.ts` for what it actually catches.
