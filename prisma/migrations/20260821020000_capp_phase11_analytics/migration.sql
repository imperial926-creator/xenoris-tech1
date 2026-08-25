-- CAPP Phase 11 — Analytics: promotion ROI, customer engagement, sales
-- attribution (spec § 29-30, § 55-57). Additive only — one new enum, one
-- new table. See schema.prisma's own "CAPP Phase 11" comment block for the
-- full field-by-field reasoning, and PromotionAnalyticsService's header for
-- why every other spec § 57 funnel step is read from already-existing
-- tables instead of a new event row.

CREATE TYPE "CustomerAnalyticsEventType" AS ENUM (
    'APP_OPENED',
    'RESTAURANT_VIEWED',
    'MENU_VIEWED',
    'PROMOTION_VIEWED',
    'PROMOTION_CLICKED',
    'REORDER_TAPPED'
);

CREATE TABLE "customer_analytics_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "eventType" "CustomerAnalyticsEventType" NOT NULL,
    "menuItemId" TEXT,
    "promotionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_analytics_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_analytics_events_org_eventType_createdAt_idx" ON "customer_analytics_events"("organizationId", "eventType", "createdAt");
CREATE INDEX "customer_analytics_events_customerAccountId_eventType_idx" ON "customer_analytics_events"("customerAccountId", "eventType");

ALTER TABLE "customer_analytics_events" ADD CONSTRAINT "customer_analytics_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_analytics_events" ADD CONSTRAINT "customer_analytics_events_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
