-- Phase 8 migration: CRM. Hand-authored to match prisma/schema.prisma, same
-- reason as every prior migration in this repo -- no network access to run
-- `prisma migrate dev` here.
--
-- Adds the customers/customer_addresses/customer_preferences/customer_notes
-- /customer_tags/customer_reviews tables (master spec §9, §31, §32), a
-- nullable Organization.crmSettings JSON column for configurable RFM
-- thresholds, and a nullable customerId column on orders/reservations/
-- catering_inquiries/catering_events so CRM analytics can aggregate a real
-- foreign key instead of matching guest contact strings -- see the
-- "Phase 8 — CRM" comment block in schema.prisma for the full reasoning.

-- Organization.crmSettings
ALTER TABLE "organizations" ADD COLUMN "crmSettings" JSONB;

-- customerId on existing tables (nullable, additive, no data migration needed)
ALTER TABLE "orders" ADD COLUMN "customerId" TEXT;
ALTER TABLE "reservations" ADD COLUMN "customerId" TEXT;
ALTER TABLE "catering_inquiries" ADD COLUMN "customerId" TEXT;
ALTER TABLE "catering_events" ADD COLUMN "customerId" TEXT;

-- Enums
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- customers
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customers_userId_key" ON "customers"("userId");
CREATE INDEX "customers_organizationId_idx" ON "customers"("organizationId");
CREATE INDEX "customers_organizationId_email_idx" ON "customers"("organizationId", "email");
CREATE INDEX "customers_organizationId_phone_idx" ON "customers"("organizationId", "phone");

-- customer_addresses
CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'PH',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_addresses_customerId_idx" ON "customer_addresses"("customerId");

-- customer_preferences
CREATE TABLE "customer_preferences" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_preferences_customerId_key_key" ON "customer_preferences"("customerId", "key");

-- customer_notes
CREATE TABLE "customer_notes" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_notes_customerId_idx" ON "customer_notes"("customerId");

-- customer_tags
CREATE TABLE "customer_tags" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_tags_customerId_tag_key" ON "customer_tags"("customerId", "tag");

-- customer_reviews
CREATE TABLE "customer_reviews" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "customerId" TEXT,
    "orderId" TEXT,
    "reservationId" TEXT,
    "cateringEventId" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_reviews_pkey" PRIMARY KEY ("id"),
    -- No Prisma schema DSL support for CHECK constraints (same gap Phase 3's
    -- EXCLUDE constraint and Phase 4's partial unique index hit) -- the
    -- database is the real guarantee behind the Zod-layer 1-5 bound.
    CONSTRAINT "customer_reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);
CREATE INDEX "customer_reviews_organizationId_idx" ON "customer_reviews"("organizationId");
CREATE INDEX "customer_reviews_customerId_idx" ON "customer_reviews"("customerId");
CREATE INDEX "customer_reviews_orderId_idx" ON "customer_reviews"("orderId");
CREATE INDEX "customer_reviews_reservationId_idx" ON "customer_reviews"("reservationId");
CREATE INDEX "customer_reviews_cateringEventId_idx" ON "customer_reviews"("cateringEventId");

-- customerId indexes on existing tables
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");
CREATE INDEX "reservations_customerId_idx" ON "reservations"("customerId");
CREATE INDEX "catering_inquiries_customerId_idx" ON "catering_inquiries"("customerId");
CREATE INDEX "catering_events_customerId_idx" ON "catering_events"("customerId");

-- Foreign keys
ALTER TABLE "customers" ADD CONSTRAINT "customers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_preferences" ADD CONSTRAINT "customer_preferences_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_cateringEventId_fkey" FOREIGN KEY ("cateringEventId") REFERENCES "catering_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "catering_inquiries" ADD CONSTRAINT "catering_inquiries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "catering_events" ADD CONSTRAINT "catering_events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
