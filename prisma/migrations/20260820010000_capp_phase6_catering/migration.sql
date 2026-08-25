-- CAPP Phase 6 — customer-facing catering (spec § 13).
--
-- Two additive, nullable columns — no backfill needed, no existing row is
-- affected:
--   * catering_inquiries.budget — spec § 13 lists "Budget" as one of the six
--     fields a diner enters when booking catering; there was no column for
--     it on the base platform's Phase 7 inquiry model.
--   * catering_quotes.customerNote — backs the "Request changes" customer
--     action. There is deliberately no new CateringQuoteStatus value for
--     this (see schema.prisma's comment on the column) — it's a message
--     field, not a new lifecycle stage.

ALTER TABLE "catering_inquiries" ADD COLUMN "budget" DECIMAL(10,2);
ALTER TABLE "catering_quotes" ADD COLUMN "customerNote" TEXT;

-- New NotificationType value — acknowledges a diner's own submitted
-- catering inquiry (CateringService.createInquiry previously fired no
-- notification at all). Kept as its own statement per Postgres's
-- ALTER TYPE ... ADD VALUE rule (cannot be used in the same transaction
-- that adds it).
ALTER TYPE "NotificationType" ADD VALUE 'CATERING_INQUIRY_RECEIVED';
