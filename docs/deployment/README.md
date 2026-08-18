# Deployment

This directory is the Phase 16 ("Deployment," the final phase of the master
build spec) runbook. It turns master spec §60 "Production Deployment"'s
sequence diagram —

```
Production database → Database migrations → Environment variables →
Application deployment → Domain configuration → HTTPS → Monitoring → Backups
```

— into an actionable set of steps, plus the two things §60 explicitly
requires beyond that diagram: rollback instructions and database backup/
restore instructions.

**Nothing in this directory has been runtime-verified.** It was authored in
a sandbox with zero outbound network access — no `npm install`, no `docker
build`, no real managed Postgres/S3/domain/CI runner to test against (see
`CLAUDE.md` → Known Issues). Treat every command here as reviewed-but-unrun;
confirm each step once in a real environment before trusting it for an
actual production deploy.

## Documents in this directory

- **production-checklist.md** — the step-by-step first-deploy checklist,
  following §60's exact sequence.
- **backups.md** — how `scripts/backup-db.sh`/`scripts/restore-db.sh` work,
  a recommended retention policy, and a restore-drill checklist.
- **rollback.md** — how to roll back a bad deploy, covering both the
  application layer (previous image/build) and the database layer (a
  schema migration that shipped with it).
- **monitoring.md** — what's actually wired up for observability (§63) as
  of this phase: `/api/health`, `lib/monitoring/logger.ts`,
  `lib/monitoring/ErrorReporter.ts` — and what's still a configuration seam
  waiting for a real provider.
- **domain-https.md** — pointing a real domain at a deployment and getting
  HTTPS in front of it; provider-agnostic per §59.

## Architecture recap (§59 "Deployment Architecture")

The master spec is explicit that this app must stay provider-agnostic
wherever the architecture allows it ("Do not hard-code any specific
provider if the architecture can remain provider-agnostic"). Concretely,
that means:

| Concern | §59 guidance | This codebase's seam |
|---|---|---|
| Frontend/app hosting | "Vercel or equivalent" | Any Node ≥20 host that can run `next start` or the `Dockerfile`'s standalone build — Vercel, Railway, Fly.io, a plain VM, ECS, etc. |
| Database | "Managed PostgreSQL" | `DATABASE_URL` — any Postgres ≥14 (RDS, Cloud SQL, Neon, Supabase, self-hosted). |
| Storage | "S3-compatible storage or equivalent" | `lib/storage/StorageProvider.ts` + `STORAGE_PROVIDER_KEY` — unconfigured stub today; no code path performs a real upload yet (see that file's header). |
| Payments | "Configurable provider" | `lib/payments/PaymentProvider.ts` + `PAYMENT_PROVIDER_KEY`. |
| Email/SMS/Push | "Configurable provider" | `lib/notifications/{Email,Sms,Push}Provider.ts`. |
| AI | "Configurable provider" | `lib/ai/AIProvider.ts` + `AI_PROVIDER_KEY` — optional; `InsightService`'s rule engine works fully without it. |
| Error tracking | (§63 Observability) | `lib/monitoring/ErrorReporter.ts` + `ERROR_REPORTING_PROVIDER_KEY`. |

Every "unconfigured" seam above fails loudly if something tries to use it
without a real provider wired in (see each file's `Unconfigured*Provider`
class) rather than silently pretending to work — the one exception is
`ErrorReporter`, which no-ops instead of throwing, documented in that
file's header.

## Mobile strategy (§61) and PWA (§62)

No native mobile app was built in this project — §61 ("if required") was
never triggered; this app is responsive-first by design across every
phase. §62's PWA guidance ("Staff dashboards should work well on tablets.
Kitchen interface should work well on large displays/tablets") is answered
with a lightweight installable PWA manifest (`public/manifest.json`, wired
into `app/layout.tsx`) rather than a native app — see that file's header
comment for the full reasoning. Phase 16's "Store configuration" build-list
item is resolved as: PWA installability, yes; literal native App
Store/Play Store submission, not applicable (no native binary exists to
submit).
