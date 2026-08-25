-- CAPP Phase 1 migration: Customer mobile app — multi-tenant identity,
-- branding, customer authentication, real-time event outbox. Hand-authored
-- to match prisma/schema.prisma, same reason as every prior migration in
-- this repo -- no network access to run `prisma migrate dev` here.
--
-- See docs/customer-app/architecture.md for the full design narrative. This
-- migration is additive only: it adds new columns (nullable) to
-- organizations/customers and five new tables. No existing column, table,
-- or constraint is altered or dropped.

-- Organization: public customer-facing tenant code + customer-app settings
ALTER TABLE "organizations" ADD COLUMN "publicCode" TEXT;
ALTER TABLE "organizations" ADD COLUMN "customerAppSettings" JSONB;
CREATE UNIQUE INDEX "organizations_publicCode_key" ON "organizations"("publicCode");

-- Customer: optional link to a self-service CustomerAccount
ALTER TABLE "customers" ADD COLUMN "customerAccountId" TEXT;
CREATE UNIQUE INDEX "customers_customerAccountId_key" ON "customers"("customerAccountId");

-- platform_sequences — backs Organization.publicCode generation (same
-- atomic-increment pattern as invoice_sequences)
CREATE TABLE "platform_sequences" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_sequences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_sequences_name_key" ON "platform_sequences"("name");

-- restaurant_branding — one row per Organization
CREATE TABLE "restaurant_branding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "coverImageUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "accentColor" TEXT,
    "description" TEXT,
    "website" TEXT,
    "socialLinks" JSONB,
    "reservationPolicy" TEXT,
    "cancellationPolicy" TEXT,
    "deliveryPolicy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "restaurant_branding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "restaurant_branding_organizationId_key" ON "restaurant_branding"("organizationId");

-- customer_accounts — platform-wide customer identity (distinct from `users`,
-- see docs/customer-app/architecture.md § 3)
CREATE TYPE "CustomerAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETION_REQUESTED');

CREATE TABLE "customer_accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT,
    "passwordHash" TEXT,
    "googleId" TEXT,
    "appleId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "profilePhotoUrl" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "termsAcceptedAt" TIMESTAMP(3),
    "privacyAcceptedAt" TIMESTAMP(3),
    "status" "CustomerAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_accounts_email_key" ON "customer_accounts"("email");
CREATE UNIQUE INDEX "customer_accounts_mobile_key" ON "customer_accounts"("mobile");
CREATE UNIQUE INDEX "customer_accounts_googleId_key" ON "customer_accounts"("googleId");
CREATE UNIQUE INDEX "customer_accounts_appleId_key" ON "customer_accounts"("appleId");

-- customer_notification_preferences — one row per CustomerAccount
CREATE TABLE "customer_notification_preferences" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "allowPromotional" BOOLEAN NOT NULL DEFAULT true,
    "allowOrderUpdates" BOOLEAN NOT NULL DEFAULT true,
    "allowReservationUpdates" BOOLEAN NOT NULL DEFAULT true,
    "allowLoyalty" BOOLEAN NOT NULL DEFAULT true,
    "allowCatering" BOOLEAN NOT NULL DEFAULT true,
    "emailPromotions" BOOLEAN NOT NULL DEFAULT true,
    "smsPromotions" BOOLEAN NOT NULL DEFAULT false,
    "pushPromotions" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_notification_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_notification_preferences_customerAccountId_key" ON "customer_notification_preferences"("customerAccountId");

-- customer_refresh_tokens — one row per issued refresh token (device/session)
CREATE TABLE "customer_refresh_tokens" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "customer_refresh_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_refresh_tokens_tokenHash_key" ON "customer_refresh_tokens"("tokenHash");
CREATE INDEX "customer_refresh_tokens_customerAccountId_idx" ON "customer_refresh_tokens"("customerAccountId");

-- realtime_events — append-only outbox (see docs/customer-app/architecture.md § 6)
CREATE TABLE "realtime_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "realtime_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "realtime_events_organizationId_createdAt_idx" ON "realtime_events"("organizationId", "createdAt");

-- Foreign keys
ALTER TABLE "customers" ADD CONSTRAINT "customers_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "restaurant_branding" ADD CONSTRAINT "restaurant_branding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_notification_preferences" ADD CONSTRAINT "customer_notification_preferences_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_refresh_tokens" ADD CONSTRAINT "customer_refresh_tokens_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "realtime_events" ADD CONSTRAINT "realtime_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: assign a publicCode to any pre-existing organizations (e.g. the
-- seeded demo org) so publicCode is never null in practice going forward,
-- even though the column stays nullable at the DB level for migration
-- safety. New organizations get one assigned at creation time
-- (OrganizationService — see services/customer/RestaurantDirectoryService.ts).
DO $$
DECLARE
  org RECORD;
  next_number INTEGER;
BEGIN
  FOR org IN SELECT "id" FROM "organizations" WHERE "publicCode" IS NULL ORDER BY "createdAt" ASC LOOP
    UPDATE "platform_sequences"
      SET "lastNumber" = "lastNumber" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "name" = 'restaurant_public_code'
      RETURNING "lastNumber" INTO next_number;
    IF next_number IS NULL THEN
      -- Bootstrap the sequence row itself. gen_random_uuid()::text yields a
      -- valid but non-cuid-shaped id (Prisma's cuid() is only ever generated
      -- application-side, not by Postgres) — cosmetically inconsistent with
      -- every other id in this table, but harmless: `id` carries no format
      -- constraint, this row is never looked up by id, and the very next
      -- application-created PlatformSequence row (if any) gets a real cuid.
      INSERT INTO "platform_sequences" ("id", "name", "lastNumber", "updatedAt")
        VALUES (gen_random_uuid()::text, 'restaurant_public_code', 1, CURRENT_TIMESTAMP);
      next_number := 1;
    END IF;
    UPDATE "organizations" SET "publicCode" = 'RST-' || LPAD(next_number::text, 6, '0') WHERE "id" = org."id";
  END LOOP;
END $$;
