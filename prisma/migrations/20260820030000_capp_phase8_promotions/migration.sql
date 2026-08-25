-- CAPP Phase 8 — Promotions: engine, targeting, campaign management,
-- redemption (spec § 16-32). Schema shape was pre-agreed in
-- docs/customer-app/architecture.md § 5 during Phase 1; this migration
-- builds it for real. Additive only — five new tables, four new enums, two
-- new reverse-relation-only columns (none, actually: every new FK lives on
-- the new tables), no existing table is altered. See schema.prisma's own
-- "CAPP Phase 8" comment block for the full field-by-field reasoning.

-- Enums

CREATE TYPE "PromotionDiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'BOGO', 'FREE_ITEM', 'BUNDLE', 'FREE_DELIVERY', 'FREE_ADDON', 'CATERING_DISCOUNT', 'RESERVATION_DISCOUNT', 'LOYALTY_REWARD', 'FIRST_ORDER', 'REPEAT_CUSTOMER', 'BIRTHDAY', 'CUSTOMER_SPECIFIC');
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "PromotionAudienceType" AS ENUM ('ALL', 'NEW', 'RETURNING', 'LOYAL', 'INACTIVE', 'ORDERED_ITEMS', 'MADE_RESERVATIONS', 'ORDERED_DELIVERY', 'ORDERED_TAKEOUT', 'BOOKED_CATERING', 'INACTIVE_DAYS', 'LOCATION', 'LOYALTY_TIER', 'SEGMENT');
CREATE TYPE "CustomerPromotionStatus" AS ENUM ('AVAILABLE', 'CLAIMED', 'REDEEMED', 'EXPIRED');

-- promotions

CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "promoCode" TEXT,
    "discountType" "PromotionDiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "minimumOrderValue" DECIMAL(10,2),
    "maximumDiscount" DECIMAL(10,2),
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "startTimeOfDay" TEXT,
    "endTimeOfDay" TEXT,
    "eligibleServices" JSONB NOT NULL DEFAULT '[]',
    "eligibleMenuItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibleCategoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "usageLimit" INTEGER,
    "customerUsageLimit" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "terms" TEXT,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "promotions_organizationId_promoCode_idx" ON "promotions"("organizationId", "promoCode");
CREATE INDEX "promotions_organizationId_status_idx" ON "promotions"("organizationId", "status");

ALTER TABLE "promotions" ADD CONSTRAINT "promotions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- promotion_campaigns

CREATE TABLE "promotion_campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audienceType" "PromotionAudienceType" NOT NULL,
    "audienceParams" JSONB,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "promotion_campaigns_organizationId_status_idx" ON "promotion_campaigns"("organizationId", "status");
CREATE INDEX "promotion_campaigns_promotionId_idx" ON "promotion_campaigns"("promotionId");

ALTER TABLE "promotion_campaigns" ADD CONSTRAINT "promotion_campaigns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotion_campaigns" ADD CONSTRAINT "promotion_campaigns_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- campaign_audiences

CREATE TABLE "campaign_audiences" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "eligibilityReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_audiences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_audiences_campaignId_customerAccountId_key" ON "campaign_audiences"("campaignId", "customerAccountId");
CREATE INDEX "campaign_audiences_campaignId_idx" ON "campaign_audiences"("campaignId");

ALTER TABLE "campaign_audiences" ADD CONSTRAINT "campaign_audiences_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "promotion_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_audiences" ADD CONSTRAINT "campaign_audiences_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- customer_promotions

CREATE TABLE "customer_promotions" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "status" "CustomerPromotionStatus" NOT NULL DEFAULT 'AVAILABLE',
    "claimedAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "timesRedeemed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_promotions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_promotions_customerAccountId_promotionId_key" ON "customer_promotions"("customerAccountId", "promotionId");
CREATE INDEX "customer_promotions_organizationId_customerAccountId_idx" ON "customer_promotions"("organizationId", "customerAccountId");

ALTER TABLE "customer_promotions" ADD CONSTRAINT "customer_promotions_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_promotions" ADD CONSTRAINT "customer_promotions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_promotions" ADD CONSTRAINT "customer_promotions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- promotion_redemptions

CREATE TABLE "promotion_redemptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promotion_redemptions_orderId_key" ON "promotion_redemptions"("orderId");
CREATE INDEX "promotion_redemptions_organizationId_promotionId_idx" ON "promotion_redemptions"("organizationId", "promotionId");
CREATE INDEX "promotion_redemptions_customerId_promotionId_idx" ON "promotion_redemptions"("customerId", "promotionId");

ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
