# Deploying to Railway

This is the Railway-specific path through the general sequence in
`production-checklist.md` (Production database → Database migrations →
Environment variables → Application deployment → Domain → HTTPS →
Monitoring → Backups). Railway happens to cover several of those steps for
you (managed Postgres, automatic TLS on its `*.up.railway.app` domain and on
custom domains, a container registry and build pipeline) — this doc says
explicitly which steps that removes and which ones you still have to do.

**Not runtime-verified.** Like the rest of `docs/deployment/`, this was
written in a sandbox with no network access — no real Railway project, no
`docker build`, no live test of these exact steps. Read `railway.json` and
this guide once against Railway's own current docs before your first real
deploy; Railway's UI and config format do change over time.

## 1. Create the project and database

1. In the Railway dashboard, **New Project → Deploy from GitHub repo**, and
   point it at this repository (push the contents of this zip to a GitHub
   repo first if you haven't already — Railway deploys from a repo, not a
   local zip).
2. Railway auto-detects `railway.json` at the repo root and builds from
   `Dockerfile` (see `build.builder: "DOCKERFILE"` in that file) — you do not
   need to change the service's build settings.
3. In the same project, **New → Database → Add PostgreSQL**. Railway
   provisions a managed Postgres instance and exposes its connection string
   as that database service's `DATABASE_URL` variable.
4. On the **app service** (not the database service), go to **Variables**
   and add a reference to the database's connection string so the app
   receives it as `DATABASE_URL` too — Railway's variable reference syntax
   (`${{Postgres.DATABASE_URL}}`, exact service name may differ) does this
   without copy-pasting the raw string. Confirm the reference resolves to a
   `postgresql://...` URL (Railway's internal Postgres URLs are usually
   already in that form).

## 2. Required environment variables

`instrumentation.ts` runs `lib/config/env.ts`'s `validateEnv()` on every
boot and **crashes the process immediately** if any of these five are
missing or too short — the app will not come up without them, by design:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | From step 1.4 above. |
| `AUTH_SECRET` | Staff/owner dashboard session signing. Generate with `openssl rand -base64 48`. |
| `CUSTOMER_AUTH_SECRET` | Customer mobile app (CAPP) session signing — must differ from `AUTH_SECRET`. |
| `PLATFORM_ADMIN_AUTH_SECRET` | SaaS Owner / Platform Admin console (`/platform-admin`) session signing — must differ from the two above. |
| `APP_URL` | The service's public URL, **no trailing slash** (e.g. `https://your-app.up.railway.app`, or your custom domain once step 4 is done). |

Set all five in the app service's **Variables** tab before the first
deploy. Everything else in `.env.example` (payment/email/SMS/push/storage/
maps/AI/error-reporting provider keys, OAuth client IDs) is optional — every
integration is abstracted behind a provider seam that falls back to an
"Integration requires configuration" response when its key is unset,
documented in each provider file's header. Add those later as you wire in
real providers.

Also set, for the Action Center bootstrap and the cron routes below:

- `PLATFORM_ADMIN_BOOTSTRAP_EMAIL` / `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD` —
  the first Platform Admin account `prisma/seed.ts` creates (there is no
  public registration endpoint for this role). Rotate the password after
  first login.
- `PLATFORM_CRON_SECRET` — generate one (`openssl rand -base64 32` is
  plenty); the external scheduler in step 5 presents it via the
  `x-cron-secret` header.

## 3. Migrations

`railway.json`'s `deploy.preDeployCommand` runs `npx prisma@5.18.0 migrate
deploy` once, against the about-to-be-live deployment, **before** it starts
receiving traffic — Railway's equivalent of a release-phase step. This
matches the Dockerfile's own stated philosophy (see its header comment):
migrations are a distinct pre-deploy step, never baked into the container's
`CMD`, so multiple replicas never race to run them concurrently.

The exact `prisma` version is pinned (`5.18.0`) to match `@prisma/client` in
`package.json` — `npx` fetches that exact CLI version at deploy time (the
Railway container has full internet access, unlike this build sandbox), so
there is no drift between the migration engine and the client the app was
built against.

Before your very first deploy — or if you'd rather run it by hand once
instead of relying on `preDeployCommand` — you can also trigger it manually
with the Railway CLI: `railway run npx prisma@5.18.0 migrate deploy`.

## 4. Domain and HTTPS

Railway issues a free `*.up.railway.app` subdomain with TLS already
terminated — nothing to configure. For a custom domain: app service →
**Settings → Networking → Custom Domain**, add your domain, then create the
CNAME record it shows you at your DNS provider. Railway provisions and
renews the certificate automatically once that CNAME resolves. Update
`APP_URL` to the new domain afterward (and redeploy, since it's read at
process boot).

## 5. Wiring the cron routes

Per `.env.example`'s note on `PLATFORM_CRON_SECRET` and
`SubscriptionRetryService.ts`'s header, this codebase has **no in-process
job scheduler** — five routes under `/api/platform-admin/cron/**`
(`subscription-retries`, `complaints-sla`, `renewal-follow-ups`,
`anomaly-sweep`, `engagement-snapshots`) exist specifically to be called by
an external scheduler, guarded by the `x-cron-secret` header. Two options,
either works — pick one, don't run both against the same route:

**Option A — GitHub Actions (included in this zip).**
`.github/workflows/platform-cron.yml` calls all five routes on the
schedules commented in that file. Set two repo secrets (Settings → Secrets
and variables → Actions): `APP_URL` and `PLATFORM_CRON_SECRET`, matching the
values you set on the Railway app service. Nothing else to configure — it
starts running once the workflow file is on your default branch.

**Option B — a Railway Cron Service per route.** Railway supports a
`deploy.cronSchedule` field that turns a service into a scheduled one-shot
job instead of a persistent web server. For each of the five routes: New
Service → Empty Service → same repo → in that service's settings set
**Start Command** to
`wget -qO- --header="x-cron-secret: $PLATFORM_CRON_SECRET" "$APP_URL/api/platform-admin/cron/<route-name>"`
and set a **Cron Schedule** (the app's Dockerfile base image already has
`wget`, so no extra install step). This avoids a GitHub dependency but means
five extra services to configure by hand — Option A is less to set up.

## 6. Monitoring, logs, backups

- Railway streams container stdout/stderr in the dashboard automatically —
  `lib/monitoring/logger.ts`'s structured JSON logs land there with nothing
  extra to configure.
- `/api/health` (round-trips the database, no auth required) is what
  `Dockerfile`'s own `HEALTHCHECK` polls; Railway's own health checks read
  `railway.json`'s `deploy.healthcheckPath`, same endpoint.
- `ERROR_REPORTING_PROVIDER_KEY` is unset by default — wire in a real
  provider via `lib/monitoring/ErrorReporter.ts` when you want
  aggregation/alerting beyond raw logs (see `monitoring.md`).
- Railway's managed Postgres has its own backup/restore tooling in its
  dashboard (Data tab); `docs/deployment/backups.md`'s `scripts/backup-db.sh`
  /`scripts/restore-db.sh` remain the provider-agnostic fallback if you'd
  rather manage backups yourself.

## 7. Bootstrap the first Platform Admin, then log in

There is no public registration endpoint for the Platform Admin role by
design (see `PlatformAdminAuthService.ts`'s header) — `production-checklist.md`'s
documented bootstrap path is re-running `npm run db:seed` with
`PLATFORM_ADMIN_BOOTSTRAP_EMAIL`/`PLATFORM_ADMIN_BOOTSTRAP_PASSWORD` set.

That script needs `tsx` (a devDependency) and the full `node_modules` to
run, which the deployed container deliberately does **not** have — the
runner image only ships the pruned standalone output (see the Dockerfile's
header on why). Run it from your own machine instead, against the Railway
project's environment, using the Railway CLI:

```
railway link          # once, to point the CLI at this project
railway run npm run db:seed
```

`railway run` injects the linked project's variables (including
`DATABASE_URL`, `PLATFORM_ADMIN_BOOTSTRAP_EMAIL/_PASSWORD`) into that local
process, so the seed script writes into the real Railway Postgres while
actually executing on your machine, where `npm install` has already
populated `node_modules` with `tsx`. This also reseeds demo data alongside
the admin account (see the header of `prisma/seed.ts`) — acceptable for a
first deploy you're about to populate with real data anyway; if you'd
rather skip the demo rows, insert the `PlatformAdmin` row directly instead
(hash the password with `lib/auth/password.ts`'s `hashPassword`, cost
factor 12) and skip this step.

Once that's done, log in at `https://<your-app>/platform-admin` with those
credentials and rotate the password immediately from the Admins & Roles
page (`/platform-admin/console/admins`).
