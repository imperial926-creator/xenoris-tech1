-- CAPP Phase 9 — Push/in-app notifications, notification center, anti-spam/
-- opt-out (spec § 21-27, § 33-34, § 47-48, § 51). Additive only — three new
-- tables, three new enums, one new reverse-relation column
-- (promotion_campaigns needed none; the FK lives on customer_notifications).
-- See schema.prisma's own "CAPP Phase 9" comment block for the full
-- field-by-field reasoning.

-- Enums

CREATE TYPE "CustomerNotificationCategory" AS ENUM ('ORDER', 'RESERVATION', 'PAYMENT', 'PROMOTION', 'LOYALTY', 'CATERING', 'SYSTEM');
CREATE TYPE "NotificationDeliveryChannel" AS ENUM ('PUSH', 'EMAIL', 'SMS', 'IN_APP');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'FAILED', 'UNSUBSCRIBED', 'BOUNCED');

-- customer_push_tokens

CREATE TABLE "customer_push_tokens" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_push_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_push_tokens_token_key" ON "customer_push_tokens"("token");
CREATE INDEX "customer_push_tokens_customerAccountId_idx" ON "customer_push_tokens"("customerAccountId");

ALTER TABLE "customer_push_tokens" ADD CONSTRAINT "customer_push_tokens_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- customer_notifications

CREATE TABLE "customer_notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "category" "CustomerNotificationCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "deepLink" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "campaignId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_notifications_campaignId_customerAccountId_key" ON "customer_notifications"("campaignId", "customerAccountId");
CREATE INDEX "customer_notifications_customerAccountId_isRead_createdAt_idx" ON "customer_notifications"("customerAccountId", "isRead", "createdAt");
CREATE INDEX "customer_notifications_organizationId_createdAt_idx" ON "customer_notifications"("organizationId", "createdAt");

ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "promotion_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- notification_deliveries

CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "customerNotificationId" TEXT NOT NULL,
    "channel" "NotificationDeliveryChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL,
    "providerReference" TEXT,
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_deliveries_customerNotificationId_idx" ON "notification_deliveries"("customerNotificationId");
CREATE INDEX "notification_deliveries_status_channel_idx" ON "notification_deliveries"("status", "channel");

ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_customerNotificationId_fkey" FOREIGN KEY ("customerNotificationId") REFERENCES "customer_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
