# Rollback

Master spec §60 requires "Provide rollback instructions" as an explicit
deliverable. There are two independent layers that can each need rolling
back: the application (code/image) and the database (a migration).
Handle them in the right order — see "Rolling back both together" below.

## Rolling back the application only

If the new deploy is broken but its database migrations (if any shipped
with it) are backward-compatible with the previous application version:

1. Redeploy the previous image/build. How, depends on your host:
   - **Container-based host** (ECS, Cloud Run, Fly.io, a plain
     Docker/Kubernetes setup): redeploy the previous image tag. Keep the
     last N image tags around specifically to make this a single command,
     not a rebuild.
   - **Vercel or a platform with built-in deploy history**: use the
     platform's "promote a previous deployment" / instant-rollback feature
     if it has one.
   - **Manual VM deploy**: keep the previous build output
     (`.next/standalone` + `.next/static` + `public/`) or previous git
     commit checked out in a parallel directory, and switch a symlink /
     process manager target back to it.
2. Confirm `/api/health` is green and do a quick smoke test (login, load
   the dashboard) before considering the rollback complete.
3. Investigate the failure in the rolled-back-from version separately —
   don't debug in production.

This is safe specifically because the application layer is stateless: no
in-memory session or job state lives only in one running process (sessions
are signed JWTs in cookies, not server-side session storage — see
`lib/auth/session.ts`).

## Rolling back a database migration

Only needed if the migration that shipped with the bad deploy is itself
the problem (a bad column type, a constraint that's rejecting valid data,
etc.) — not just "the deploy was broken for unrelated reasons," which the
app-only rollback above already fixes.

Prisma Migrate does not have a built-in automatic "undo last migration"
command for a deployed database (unlike `migrate dev`'s local reset).
Two options, in order of preference:

### Option A — forward-fix (preferred)

Write a new migration that reverses the problematic change, and deploy it
through the normal pipeline (`npx prisma migrate dev --name fix_x` locally,
commit it, `npm run db:migrate:deploy` in production). This keeps the
migration history linear and auditable — the same reason this project's
accounting ledger uses reversal entries (`AccountingService`'s post/reverse
pattern) instead of ever deleting a posted journal entry. Prefer this
unless the situation is severe enough that production is actively unusable
right now.

### Option B — restore from backup (only for a severe, data-corrupting migration)

If the migration already corrupted data such that no forward-fix can
recover it cleanly:

1. Stop the application (or put it in maintenance mode) to prevent further
   writes against the broken schema.
2. Follow `backups.md`'s restore procedure using the most recent backup
   taken **before** the bad migration ran.
3. Any writes that happened between that backup and the incident are lost
   — this is why `backups.md`'s retention/frequency guidance matters, and
   why the restore-drill checklist there should already have been run
   before this is ever needed for real.
4. Redeploy the previous, known-good application version (the app-only
   rollback above) so it matches the restored schema.

## Rolling back both together

If both the app and the migration need reverting: stop new traffic (or use
your host's maintenance-mode feature) → restore/fix the database first
(Option A or B above) → then redeploy the previous application version →
confirm `/api/health` and a smoke test → resume traffic. Doing it in this
order avoids a window where the new (bad) app code is running against an
already-rolled-back (old) schema, or vice versa.

## After any rollback

- Write down what broke and why — this project's own audit-log discipline
  (`writeAuditLog`, see `lib/audit/log.ts`) exists so business-data changes
  are never a mystery after the fact; apply the same standard to
  deploy-process incidents.
- If the root cause was something CI didn't catch (see
  `.github/workflows/ci.yml`), add a test or check that would have caught
  it before the next deploy.
