-- Phase 15 hardening (performance review): index changes only.
-- Hand-authored to match prisma/schema.prisma, same reason as every prior
-- migration in this repo -- no network access to run `prisma migrate dev`
-- here. No table/column shape changes in this migration.

-- notifications: replace the old (organizationId, createdAt) index.
-- NotificationService.list always filters by organizationId AND branchId
-- together (never organizationId alone), so the 3-column index below
-- serves that query directly while still covering any future
-- organizationId-only lookup via Postgres's leftmost-prefix rule.
DROP INDEX "notifications_organizationId_createdAt_idx";
CREATE INDEX "notifications_organizationId_branchId_createdAt_idx" ON "notifications"("organizationId", "branchId", "createdAt");

-- orders: add a second composite index alongside the existing
-- (branchId, createdAt) one. OrderService.list filters by branchId and
-- optionally status/type; the existing 2-column index still serves the
-- "no status filter" board view, and this new one serves the equally
-- common status-filtered view (e.g. status: 'PENDING').
CREATE INDEX "orders_branchId_status_createdAt_idx" ON "orders"("branchId", "status", "createdAt");

-- journal_entries: AccountingService.listJournalEntries always filters by
-- organizationId and sorts/range-filters by entryDate; no prior index
-- covered entryDate, so that query fell back to a full org-scoped scan
-- plus an in-memory sort.
CREATE INDEX "journal_entries_organizationId_entryDate_idx" ON "journal_entries"("organizationId", "entryDate");
