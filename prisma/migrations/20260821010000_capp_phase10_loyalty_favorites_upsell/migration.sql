-- CAPP Phase 10 — Loyalty, favorites, reordering, upselling (spec § 37-39).
-- Additive only — one new column on the existing promotions table, two new
-- enums, and three new tables. See schema.prisma's own "CAPP Phase 10"
-- comment block for the full field-by-field reasoning.

-- promotions.loyaltyPointsCost — required only for discountType =
-- 'LOYALTY_REWARD', enforced at the Zod layer (no Prisma/SQL support for a
-- conditional-required column), same approach as the sibling
-- minimumOrderValue/maximumDiscount columns already on this table.

ALTER TABLE "promotions" ADD COLUMN "loyaltyPointsCost" INTEGER;

-- Enums

CREATE TYPE "LoyaltyTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');
CREATE TYPE "LoyaltyTransactionType" AS ENUM ('EARN', 'REDEEM', 'EXPIRE', 'ADJUST');

-- loyalty_accounts

CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "tier" "LoyaltyTier" NOT NULL DEFAULT 'BRONZE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "loyalty_accounts_organizationId_customerAccountId_key" ON "loyalty_accounts"("organizationId", "customerAccountId");

ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- loyalty_transactions

CREATE TABLE "loyalty_transactions" (
    "id" TEXT NOT NULL,
    "loyaltyAccountId" TEXT NOT NULL,
    "type" "LoyaltyTransactionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "description" TEXT,
    "relatedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "loyalty_transactions_loyaltyAccountId_createdAt_idx" ON "loyalty_transactions"("loyaltyAccountId", "createdAt");

ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_loyaltyAccountId_fkey" FOREIGN KEY ("loyaltyAccountId") REFERENCES "loyalty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_relatedOrderId_fkey" FOREIGN KEY ("relatedOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- customer_favorites

CREATE TABLE "customer_favorites" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "menuItemId" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_favorites_pkey" PRIMARY KEY ("id"),
    -- Exactly one of menuItemId/orderId set, never both, never neither — no
    -- Prisma schema DSL support for cross-column CHECK constraints, same gap
    -- Phase 3/4/8/10's other CHECK constraints hit (see e.g.
    -- journal_entry_lines_debit_xor_credit_check).
    CONSTRAINT "customer_favorites_item_xor_order_check" CHECK (
        ("menuItemId" IS NOT NULL AND "orderId" IS NULL) OR ("menuItemId" IS NULL AND "orderId" IS NOT NULL)
    )
);

-- Postgres treats each NULL as distinct within a unique index, so these two
-- constraints only actually enforce uniqueness among their own non-null
-- rows (favorite-item rows all have orderId NULL and vice versa) — see
-- schema.prisma's CustomerFavorite comment for why that needs no special
-- handling.
CREATE UNIQUE INDEX "customer_favorites_customerAccountId_menuItemId_key" ON "customer_favorites"("customerAccountId", "menuItemId");
CREATE UNIQUE INDEX "customer_favorites_customerAccountId_orderId_key" ON "customer_favorites"("customerAccountId", "orderId");
CREATE INDEX "customer_favorites_organizationId_customerAccountId_idx" ON "customer_favorites"("organizationId", "customerAccountId");

ALTER TABLE "customer_favorites" ADD CONSTRAINT "customer_favorites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_favorites" ADD CONSTRAINT "customer_favorites_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_favorites" ADD CONSTRAINT "customer_favorites_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_favorites" ADD CONSTRAINT "customer_favorites_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- menu_item_recommendations

CREATE TABLE "menu_item_recommendations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "recommendedMenuItemId" TEXT NOT NULL,
    "label" TEXT,
    "bundlePrice" DECIMAL(10,2),
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_item_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "menu_item_recommendations_menuItemId_recommendedMenuItemId_key" ON "menu_item_recommendations"("menuItemId", "recommendedMenuItemId");
CREATE INDEX "menu_item_recommendations_organizationId_menuItemId_idx" ON "menu_item_recommendations"("organizationId", "menuItemId");

ALTER TABLE "menu_item_recommendations" ADD CONSTRAINT "menu_item_recommendations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_item_recommendations" ADD CONSTRAINT "menu_item_recommendations_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_item_recommendations" ADD CONSTRAINT "menu_item_recommendations_recommendedMenuItemId_fkey" FOREIGN KEY ("recommendedMenuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
