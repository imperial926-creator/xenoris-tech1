# Production Deployment Checklist

Follows master spec §60's exact sequence:
`Production database → Database migrations → Environment variables →
Application deployment → Domain configuration → HTTPS → Monitoring →
Backups`. Each step below names the concrete file/command that implements
it in this codebase.

## 1. Production database

- [ ] Provision a managed PostgreSQL instance, version ≥ 14 (§59:
      "Managed PostgreSQL" — any provider; RDS, Cloud SQL, Neon, Supabase,
      self-hosted are all fine, nothing here is provider-specific).
- [ ] Restrict network access to only the app's hosting environment
      (security group / firewall rule / private networking, whichever the
      chosen provider offers) — never expose the database port publicly.
- [ ] Create the database and a dedicated application role (not the
      provider's default superuser) with privileges scoped to that
      database.
- [ ] Record the connection string — this becomes `DATABASE_URL`.

## 2. Database migrations

- [ ] Run migrations against the production database **before** the new
      application version starts receiving traffic:
      ```bash
      DATABASE_URL="<production connection string>" npm run db:migrate:deploy
      ```
      (`prisma migrate deploy` — applies pending migrations without
      generating new ones or prompting, safe for non-interactive CI/CD.)
- [ ] This is a distinct, one-time step — it is deliberately NOT baked into
      `Dockerfile`'s `CMD` (see that file's header comment): running it from
      every container replica on boot would race multiple instances against
      each other.
- [ ] If this is the very first production deploy, immediately after
      migrations: `npm run db:seed` seeds only clearly-`[DEMO]`-prefixed
      sample data — skip it in production, or run it only against a
      throwaway/staging database. Production's first real data should come
      from `/register` (org signup), not the seed script.

## 3. Environment variables

- [ ] Copy `.env.example` and fill in real production values. At minimum,
      required (validated eagerly at boot by `lib/config/env.ts` via
      `instrumentation.ts` — the process will refuse to start without
      these):
  - `DATABASE_URL` — from step 1.
  - `AUTH_SECRET` — generate with `openssl rand -base64 48`. **Never**
    reuse a dev/test secret in production; rotating it invalidates every
    existing session.
  - `CUSTOMER_AUTH_SECRET` — generate the same way, with `openssl rand
    -base64 48`. Joined the required set in CAPP Phase 1 (see
    `lib/config/env.ts`'s header) — the customer mobile app's entire auth
    surface depends on it. **Must be a different value than `AUTH_SECRET`**
    (see `lib/customer-auth/session.ts`); reusing the staff secret is not a
    shortcut, it's a cross-audience token-forgery risk.
  - `APP_URL` — the real production URL, no trailing slash. Also what the
    customer mobile app's Universal/App Links resolve against — see
    `capp-mobile.md` if a native app build is part of this deploy.
- [ ] Optional provider keys (`PAYMENT_PROVIDER_KEY`, `EMAIL_PROVIDER_KEY`,
      `SMS_PROVIDER_KEY`, `PUSH_NOTIFICATION_KEY`, `STORAGE_PROVIDER_KEY`,
      `MAPS_API_KEY`, `AI_PROVIDER_KEY`, `ERROR_REPORTING_PROVIDER_KEY`) —
      set any that have a real provider wired in; leave unset for any that
      don't. The app runs fully with all of them unset (every feature that
      touches one degrades to a documented "not configured" state rather
      than failing — see each `lib/*/*.Provider.ts` file).
- [ ] Store these as your host's/orchestrator's native secret mechanism
      (platform env vars, a secrets manager, Kubernetes Secrets) — never
      commit a filled-in `.env` to version control.

## 4. Application deployment

- [ ] Build the production image: `docker build -t restaurant-platform .`
      (see `Dockerfile` — multi-stage, `output: 'standalone'`, non-root
      user, built-in `HEALTHCHECK` against `/api/health`).
  - Or, on a platform that builds from source directly (Vercel and
    similar): `npm ci && npx prisma generate && npm run build`, then
    `npm run start`.
- [ ] Deploy the new version. If running more than one replica, ensure
      migrations (step 2) have already been applied against the shared
      database before any replica starts — every replica reads the same
      schema.
- [ ] Confirm the new version is serving traffic before decommissioning the
      previous one (see `rollback.md` if this step fails).

## 5. Domain configuration

- [ ] Point your domain's DNS at the hosting provider per that provider's
      instructions (a CNAME to a platform-managed hostname, or an A/AAAA
      record to a static IP — this varies by host, see `domain-https.md`).
- [ ] Update `APP_URL` to the final domain and redeploy if it changed from
      what step 3 used.

## 6. HTTPS

- [ ] Confirm HTTPS is terminating correctly (most managed platforms
      provision/renew TLS certificates automatically once DNS is pointed
      correctly — see `domain-https.md` for the self-hosted case).
- [ ] `next.config.js`'s `Strict-Transport-Security` header is already
      configured (Phase 15 hardening) and only takes effect once real HTTPS
      is in front of the app — verify it's actually being sent:
      `curl -sI https://<your-domain>/ | grep -i strict-transport-security`.

## 7. Monitoring

- [ ] Confirm `/api/health` responds `200 { status: "ok" }` from outside
      the deployment network (this is what your load balancer / uptime
      monitor should poll — see `monitoring.md`).
- [ ] Wire an uptime monitor (any provider — Pingdom, UptimeRobot, your
      cloud host's built-in health checks, etc.) against `/api/health`.
- [ ] If `ERROR_REPORTING_PROVIDER_KEY` is configured, confirm errors are
      actually arriving in that provider's dashboard (trigger a harmless
      test error against a non-production environment first).
- [ ] Confirm structured logs (`lib/monitoring/logger.ts`'s JSON lines) are
      reaching wherever your host aggregates stdout/stderr.

## 8. Backups

- [ ] Schedule `scripts/backup-db.sh` to run on a recurring basis (cron, a
      scheduled CI job, or your managed Postgres provider's built-in
      automated backups — see `backups.md` for retention guidance).
- [ ] Run one manual restore drill (`scripts/restore-db.sh`) against a
      scratch database before going live, so the first time it's used
      isn't during an actual incident.

## Post-deploy sanity check

- [ ] `/register` creates a new organization successfully.
- [ ] Login works for the new org's owner account.
- [ ] A reservation, an order, and an expense can each be created without
      error (exercises the DB write path, the accounting engine, and
      `NotificationService`'s best-effort dispatch in one pass).
- [ ] `/api/health` is green.
- [ ] If the customer mobile app (CAPP) is part of this release, its own
      `POST /api/v1/auth/login` and one `GET /api/v1/restaurants/:id` succeed
      against this deploy's `APP_URL` — see `capp-mobile.md` for the
      full build/submit sequence, which is a separate track from steps 1-8
      above (this checklist covers the backend only; the mobile app doesn't
      redeploy when the backend does, and vice versa).

## Phase 17 addendum — Platform Subscription Billing

A separate track from steps 1-8 above, same relationship `capp-mobile.md` has to this checklist:
run this once, in addition to (not instead of) everything above, before restaurant owners can
subscribe. See `docs/architecture.md` §25 for the full design; this is the mechanical setup only.

- [ ] Set `PLATFORM_ADMIN_AUTH_SECRET` (a long random value — `openssl rand -base64 48`,
      **different** from `AUTH_SECRET` and `CUSTOMER_AUTH_SECRET`). The app will not boot without
      it — see `lib/config/env.ts`.
- [ ] Choose and configure a real subscription-billing payment gateway (PayMongo, Maya Business,
      Stripe Billing, or similar — must support recurring subscriptions, hosted/tokenized card
      capture, and webhooks). Implement it against `lib/platform-billing/
      SubscriptionGatewayProvider.ts` and register it in `getSubscriptionGatewayProvider()` — no
      concrete provider ships with this codebase (§25's "no fake integrations" note).
- [ ] Set `SUBSCRIPTION_PAYMENT_PROVIDER_KEY` and `SUBSCRIPTION_PAYMENT_WEBHOOK_SECRET`.
- [ ] Point the gateway's webhook delivery at
      `POST https://<your-domain>/api/webhooks/subscription-payment`.
- [ ] Bootstrap the first `PlatformAdmin` account: set
      `PLATFORM_ADMIN_BOOTSTRAP_EMAIL`/`PLATFORM_ADMIN_BOOTSTRAP_PASSWORD` and re-run
      `npm run db:seed`, or insert the row directly (hash the password with
      `lib/auth/password.ts`'s `hashPassword`, cost factor 12). There is no public registration
      endpoint for this role by design — see `PlatformAdminAuthService.ts`'s header.
- [ ] Sign in at `/platform-admin/login`, then in **Billing → Configuration**: set the environment
      (TEST first), confirm "Payment Gateway: Connected", and record the settlement bank name +
      last-4-digits for your own reference (the real settlement account is configured directly at
      the payment provider's merchant dashboard — never here; see §25 and
      `PlatformBillingConfig`'s header in `prisma/schema.prisma`).
- [ ] In **Billing → SMS Settings**: set the SaaS Owner notification number and send a test SMS
      before enabling production notifications (master spec §28's explicit gate) — requires
      `SMS_PROVIDER_KEY` to already be configured per this checklist's main Phase 14 setup.
- [ ] In **Billing → Subscription Plans**: create at least one ACTIVE plan (pricing is data, not
      code — see `SubscriptionPlanService.ts`'s header).
- [ ] Run one full test-mode checkout end to end as a restaurant owner (`/dashboard/billing` →
      Subscribe → a real test card from the gateway's sandbox) and confirm: the subscription
      reaches `ACTIVE` only after the webhook fires (never immediately on redirect — this is the
      one behavior worth deliberately trying to break), an invoice appears in
      `/dashboard/billing/history`, and the configured SMS number receives the payment
      notification.
- [ ] Set `PLATFORM_CRON_SECRET` and point an external scheduler (real cron, your host's built-in
      cron, or a manual trigger) at
      `POST /api/platform-admin/cron/subscription-retries` with header `x-cron-secret: <secret>`
      — this codebase has no in-process job runner, so failed-payment retries and grace-period
      suspensions only progress when something calls this on a schedule (hourly is reasonable).
      See `SubscriptionRetryService.ts`'s header.
- [ ] Only once all of the above is verified in TEST mode: switch **Billing → Configuration** to
      LIVE and confirm the gateway's live webhook secret/keys are the ones actually configured
      (not the test ones left over from the step above).
