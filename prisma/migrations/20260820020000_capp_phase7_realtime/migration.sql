-- CAPP Phase 7 — real-time synchronization (spec § 43).
--
-- The `realtime_events` outbox table itself shipped in Phase 1
-- (prisma/migrations/20260818060000_capp_phase1_foundation), but — see
-- docs/customer-app/architecture.md § 6/§ 16 — nothing ever actually wrote
-- to it: no emit helper, no SSE route, zero call sites. This phase builds
-- both, and this migration adds the one schema change that design needs:
-- a nullable `customerAccountId` so a personal event (a diner's own
-- OrderAccepted) can be addressed to exactly the CustomerAccount it
-- belongs to, instead of broadcasting every event to every connected
-- client. See RealtimeEvent's schema.prisma comment for the full
-- reasoning. Additive and nullable — no backfill needed, no existing row
-- is affected (the table has never had any rows written to it).

ALTER TABLE "realtime_events" ADD COLUMN "customerAccountId" TEXT;

DROP INDEX "realtime_events_organizationId_createdAt_idx";
CREATE INDEX "realtime_events_organizationId_customerAccountId_createdA_idx" ON "realtime_events"("organizationId", "customerAccountId", "createdAt");

ALTER TABLE "realtime_events" ADD CONSTRAINT "realtime_events_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
