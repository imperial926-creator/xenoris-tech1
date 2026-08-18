# Backups and Restore

Master spec §60 requires both "Backups" as a deploy-sequence step and
explicit "database backup and restore instructions." This document is
those instructions; `scripts/backup-db.sh` and `scripts/restore-db.sh` are
the implementation.

## What's backed up

The entire Postgres database — every table this platform writes to: RBAC,
reservations, orders, catering, CRM, inventory, the full accounting ledger
(journal entries, accounting periods), notifications, and audit logs.
There is no separate object-storage backup concern yet: `STORAGE_PROVIDER_KEY`
is unconfigured (see `lib/storage/StorageProvider.ts`), so no file uploads
exist outside the database to separately back up. Once a real storage
provider is wired in, that provider's own backup/versioning story (e.g. S3
versioning + lifecycle rules) becomes a second, independent concern —
revisit this document when that happens.

## Taking a backup

```bash
export DATABASE_URL="<production connection string>"
./scripts/backup-db.sh /path/to/backup/directory   # defaults to ./backups
```

Produces a timestamped custom-format `pg_dump` archive
(`restaurant-platform-<UTC timestamp>.dump`). Custom format (`-Fc`) rather
than plain SQL because it supports parallel restore and selective
table-level restore if only part of the data needs recovering.

### Automating it

Run this on a schedule appropriate to how much data loss is acceptable
between backups (an hourly cron job, a scheduled CI/CD job, or your managed
Postgres provider's built-in automated-backup feature — most managed
providers, e.g. RDS/Cloud SQL/Neon, already offer continuous or daily
automated backups with point-in-time recovery, which may make running this
script redundant with the provider's own mechanism. Prefer the provider's
native mechanism if it exists and meets your retention needs; use this
script as a portable fallback or for an independent off-provider copy).

### Retention (recommendation, not enforced by this script)

- Daily backups retained 7–14 days.
- Weekly backups retained 4–8 weeks.
- Monthly backups retained 6–12 months, longer if required by the
  business's own record-keeping needs for financial data (this platform's
  accounting ledger is the system of record for revenue/COGS/expenses —
  treat its retention policy accordingly).

Store backups somewhere independent of the production database's own
infrastructure (a separate object-storage bucket/region, not a disk on the
same host) so a database-host failure can't take the backups down with it.

## Restoring

```bash
export DATABASE_URL="<target connection string — NOT production unless this is a real recovery>"
./scripts/restore-db.sh /path/to/restaurant-platform-<timestamp>.dump
```

The script requires typing the target database name to confirm before
proceeding — it is destructive (`pg_restore --clean --if-exists` drops
existing objects in the target database before restoring).

### Restore drill checklist

Run this at least once before the first real production deploy, and
periodically afterward (a backup no one has ever restored from is an
unverified assumption, not a safety net):

1. Provision a scratch Postgres database (never production).
2. Point `DATABASE_URL` at it.
3. Run `scripts/restore-db.sh` against a real backup file.
4. Run `npm run db:migrate:deploy` against the restored database to confirm
   it's compatible with the current migration history (a very old backup
   restored against a newer codebase should still be bringable up to date
   this way).
5. Spot-check a few tables (`npm run db:studio` or `psql`) — row counts and
   a couple of known records look right.
6. Tear down the scratch database.

## What backups do NOT cover

- Environment variables / secrets (`AUTH_SECRET`, provider keys) — these
  live in your host's/orchestrator's secret store, not the database. Back
  those up separately (most secret managers version/back up automatically;
  confirm your specific provider's behavior).
- Application code — this is what version control + your deploy pipeline
  already handles; see `rollback.md` for reverting a bad application
  deploy specifically.
