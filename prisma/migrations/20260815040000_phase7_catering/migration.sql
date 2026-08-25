-- Phase 7 migration: catering packages, inquiries, quotes (+ quote line
-- items), events (+ event line items), and catering payments. Hand-authored
-- to match prisma/schema.prisma for the same reason as every prior
-- migration in this repo -- no network access to run `prisma migrate dev`
-- here.
--
-- Reuses the existing "OrderPaymentMethod"/"OrderPaymentStatus" enums for
-- catering_payments rather than duplicating them -- see the "Phase 7 —
-- Catering" comment block in schema.prisma (#3) for the full reasoning.

-- Enums
CREATE TYPE "CateringInquiryStatus" AS ENUM ('NEW', 'QUOTED', 'CONVERTED', 'CANCELLED');
CREATE TYPE "CateringQuoteStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "CateringEventStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "CateringPaymentType" AS ENUM ('DEPOSIT', 'BALANCE');

-- catering_packages
CREATE TABLE "catering_packages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricePerGuest" DECIMAL(10,2) NOT NULL,
    "minGuests" INTEGER,
    "maxGuests" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "catering_packages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catering_packages_branchId_name_key" ON "catering_packages"("branchId", "name");
CREATE INDEX "catering_packages_organizationId_idx" ON "catering_packages"("organizationId");

-- catering_inquiries
CREATE TABLE "catering_inquiries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerUserId" TEXT,
    "guestName" TEXT,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "eventType" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "guestCount" INTEGER NOT NULL,
    "packageId" TEXT,
    "menuRequirements" TEXT,
    "equipmentRequests" TEXT,
    "staffRequests" TEXT,
    "setupRequests" TEXT,
    "deliveryRequested" BOOLEAN NOT NULL DEFAULT false,
    "deliveryAddress" TEXT,
    "specialRequests" TEXT,
    "status" "CateringInquiryStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "catering_inquiries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "catering_inquiries_organizationId_idx" ON "catering_inquiries"("organizationId");
CREATE INDEX "catering_inquiries_branchId_status_idx" ON "catering_inquiries"("branchId", "status");
CREATE INDEX "catering_inquiries_customerUserId_idx" ON "catering_inquiries"("customerUserId");

-- catering_quotes
CREATE TABLE "catering_quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "packageId" TEXT,
    "guestCount" INTEGER NOT NULL,
    "foodTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "staffingTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "equipmentTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "transportationTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "setupTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "serviceFeeTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "CateringQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "catering_quotes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "catering_quotes_organizationId_idx" ON "catering_quotes"("organizationId");
CREATE INDEX "catering_quotes_branchId_status_idx" ON "catering_quotes"("branchId", "status");
CREATE INDEX "catering_quotes_inquiryId_idx" ON "catering_quotes"("inquiryId");

-- catering_quote_items
CREATE TABLE "catering_quote_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "lineTotal" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "catering_quote_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "catering_quote_items_quoteId_idx" ON "catering_quote_items"("quoteId");

-- catering_events
CREATE TABLE "catering_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "customerUserId" TEXT,
    "guestName" TEXT,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "eventType" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "guestCount" INTEGER NOT NULL,
    "status" "CateringEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "total" DECIMAL(10,2) NOT NULL,
    "depositAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "catering_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catering_events_quoteId_key" ON "catering_events"("quoteId");
CREATE INDEX "catering_events_organizationId_idx" ON "catering_events"("organizationId");
CREATE INDEX "catering_events_branchId_status_idx" ON "catering_events"("branchId", "status");
CREATE INDEX "catering_events_customerUserId_idx" ON "catering_events"("customerUserId");

-- catering_event_items
CREATE TABLE "catering_event_items" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "lineTotal" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "catering_event_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "catering_event_items_eventId_idx" ON "catering_event_items"("eventId");

-- catering_payments
CREATE TABLE "catering_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "CateringPaymentType" NOT NULL,
    "method" "OrderPaymentMethod" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "OrderPaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "note" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catering_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "catering_payments_organizationId_idx" ON "catering_payments"("organizationId");
CREATE INDEX "catering_payments_eventId_idx" ON "catering_payments"("eventId");

-- Foreign keys
ALTER TABLE "catering_packages" ADD CONSTRAINT "catering_packages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catering_packages" ADD CONSTRAINT "catering_packages_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "catering_inquiries" ADD CONSTRAINT "catering_inquiries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catering_inquiries" ADD CONSTRAINT "catering_inquiries_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catering_inquiries" ADD CONSTRAINT "catering_inquiries_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "catering_inquiries" ADD CONSTRAINT "catering_inquiries_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "catering_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "catering_quotes" ADD CONSTRAINT "catering_quotes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catering_quotes" ADD CONSTRAINT "catering_quotes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catering_quotes" ADD CONSTRAINT "catering_quotes_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "catering_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catering_quotes" ADD CONSTRAINT "catering_quotes_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "catering_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "catering_quote_items" ADD CONSTRAINT "catering_quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "catering_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "catering_events" ADD CONSTRAINT "catering_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catering_events" ADD CONSTRAINT "catering_events_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catering_events" ADD CONSTRAINT "catering_events_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "catering_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catering_events" ADD CONSTRAINT "catering_events_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "catering_event_items" ADD CONSTRAINT "catering_event_items_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "catering_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "catering_payments" ADD CONSTRAINT "catering_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catering_payments" ADD CONSTRAINT "catering_payments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catering_payments" ADD CONSTRAINT "catering_payments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "catering_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
