-- Phase 14 migration: Notifications. Hand-authored to match
-- prisma/schema.prisma, same reason as every prior migration in this repo
-- -- no network access to run `prisma migrate dev` here.
--
-- One new table, notifications -- one row per attempted send (one channel
-- per row), covering every master spec §40 notification type. See
-- schema.prisma's "Phase 14 — Notifications" comment block for the full
-- reasoning, including why reminder-type notifications are not wired to
-- any automatic scheduler in this build.

-- Enums
CREATE TYPE "NotificationType" AS ENUM ('RESERVATION_CONFIRMATION', 'RESERVATION_REMINDER', 'DEPOSIT_REMINDER', 'ORDER_CONFIRMATION', 'ORDER_STATUS', 'DELIVERY_UPDATE', 'CATERING_QUOTATION', 'CATERING_REMINDER', 'PAYMENT_REMINDER', 'INVOICE', 'REVIEW_REQUEST');
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH');
CREATE TYPE "NotificationStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED_NOT_CONFIGURED', 'SKIPPED_NO_RECIPIENT');

-- notifications
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "recipient" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "providerReference" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notifications_organizationId_type_idx" ON "notifications"("organizationId", "type");
CREATE INDEX "notifications_organizationId_createdAt_idx" ON "notifications"("organizationId", "createdAt");
CREATE INDEX "notifications_relatedEntityType_relatedEntityId_idx" ON "notifications"("relatedEntityType", "relatedEntityId");

-- Foreign keys
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
