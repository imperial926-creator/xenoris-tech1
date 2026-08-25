-- Phase 17 — Platform Subscription Billing (SaaS Owner <-> Restaurant Owner).
-- See the large comment block in schema.prisma immediately above the
-- PlatformAdmin model for the full architectural rationale: a new,
-- non-org-scoped admin actor (PlatformAdmin) plus a sibling payment-provider
-- abstraction for recurring billing, separate from Phase 4's order-payment
-- PaymentProvider seam. Additive only — no existing table is altered except
-- for the new back-relations on "organizations", which Prisma relations
-- don't require any DDL for (FK lives on the child table).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "PlatformAdminStatus" AS ENUM (
    'ACTIVE',
    'DISABLED'
);

CREATE TYPE "SubscriptionPlanStatus" AS ENUM (
    'ACTIVE',
    'ARCHIVED'
);

CREATE TYPE "BillingCustomerStatus" AS ENUM (
    'ACTIVE',
    'CLOSED'
);

CREATE TYPE "SubscriptionPaymentMethodStatus" AS ENUM (
    'ACTIVE',
    'EXPIRED',
    'REMOVED'
);

CREATE TYPE "SubscriptionStatus" AS ENUM (
    'INCOMPLETE',
    'ACTIVE',
    'PAST_DUE',
    'SUSPENDED',
    'CANCELLED'
);

CREATE TYPE "SubscriptionPaymentStatus" AS ENUM (
    'INITIATED',
    'SUCCEEDED',
    'FAILED',
    'REFUNDED'
);

CREATE TYPE "PlatformInvoiceStatus" AS ENUM (
    'ISSUED',
    'VOID'
);

CREATE TYPE "PlatformRefundStatus" AS ENUM (
    'PENDING',
    'SUCCEEDED',
    'FAILED'
);

CREATE TYPE "PaymentDisputeStatus" AS ENUM (
    'OPEN',
    'UNDER_REVIEW',
    'WON',
    'LOST'
);

CREATE TYPE "ActionCenterTaskStatus" AS ENUM (
    'OPEN',
    'RESOLVED'
);

CREATE TYPE "PlatformBillingEnvironment" AS ENUM (
    'TEST',
    'LIVE'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE "platform_admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "status" "PlatformAdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" NUMERIC(10,2) NOT NULL,
    "promoPrice" NUMERIC(10,2),
    "promoValidUntil" TIMESTAMP(3),
    "billingIntervalMonths" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "features" JSONB NOT NULL,
    "usageLimits" JSONB,
    "status" "SubscriptionPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_plans_planCode_key" ON "subscription_plans"("planCode");
CREATE INDEX "subscription_plans_status_displayOrder_idx" ON "subscription_plans"("status", "displayOrder");

CREATE TABLE "billing_customers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentProvider" TEXT NOT NULL,
    "providerCustomerId" TEXT NOT NULL,
    "billingEmail" TEXT NOT NULL,
    "billingName" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "status" "BillingCustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_customers_organizationId_key" ON "billing_customers"("organizationId");
CREATE UNIQUE INDEX "billing_customers_paymentProvider_providerCustomerId_key" ON "billing_customers"("paymentProvider", "providerCustomerId");

CREATE TABLE "subscription_payment_methods" (
    "id" TEXT NOT NULL,
    "billingCustomerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPaymentMethodId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cardBrand" TEXT,
    "lastFour" TEXT,
    "expirationMonth" INTEGER,
    "expirationYear" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "status" "SubscriptionPaymentMethodStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_payment_methods_provider_providerPaymentMethod_key" ON "subscription_payment_methods"("provider", "providerPaymentMethodId");
CREATE INDEX "subscription_payment_methods_billingCustomerId_idx" ON "subscription_payment_methods"("billingCustomerId");

CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "billingCustomerId" TEXT NOT NULL,
    "paymentMethodId" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'INCOMPLETE',
    "billingIntervalMonths" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "nextBillingDate" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "gracePeriodEndsAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "providerSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscriptions_organizationId_key" ON "subscriptions"("organizationId");
CREATE UNIQUE INDEX "subscriptions_billingCustomerId_key" ON "subscriptions"("billingCustomerId");
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");
CREATE INDEX "subscriptions_nextBillingDate_idx" ON "subscriptions"("nextBillingDate");
CREATE INDEX "subscriptions_nextRetryAt_idx" ON "subscriptions"("nextRetryAt");

CREATE TABLE "subscription_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "paymentProvider" TEXT NOT NULL,
    "providerCustomerId" TEXT,
    "providerPaymentId" TEXT,
    "providerTransactionId" TEXT,
    "amount" NUMERIC(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "paymentMethodType" TEXT,
    "cardBrand" TEXT,
    "cardLastFour" TEXT,
    "billingPeriodStart" TIMESTAMP(3),
    "billingPeriodEnd" TIMESTAMP(3),
    "paymentAttempt" INTEGER NOT NULL DEFAULT 1,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "subscription_payments_organizationId_createdAt_idx" ON "subscription_payments"("organizationId", "createdAt");
CREATE INDEX "subscription_payments_subscriptionId_status_idx" ON "subscription_payments"("subscriptionId", "status");
CREATE INDEX "subscription_payments_providerTransactionId_idx" ON "subscription_payments"("providerTransactionId");

CREATE TABLE "platform_invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "paymentId" TEXT,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL,
    "billingPeriodEnd" TIMESTAMP(3) NOT NULL,
    "subtotal" NUMERIC(10,2) NOT NULL,
    "discount" NUMERIC(10,2) NOT NULL DEFAULT 0,
    "tax" NUMERIC(10,2) NOT NULL DEFAULT 0,
    "total" NUMERIC(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_invoices_invoiceNumber_key" ON "platform_invoices"("invoiceNumber");
CREATE UNIQUE INDEX "platform_invoices_paymentId_key" ON "platform_invoices"("paymentId");
CREATE INDEX "platform_invoices_organizationId_issuedAt_idx" ON "platform_invoices"("organizationId", "issuedAt");

CREATE TABLE "platform_refunds" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amount" NUMERIC(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "administratorId" TEXT NOT NULL,
    "providerReference" TEXT,
    "status" "PlatformRefundStatus" NOT NULL DEFAULT 'PENDING',
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_refunds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_refunds_organizationId_createdAt_idx" ON "platform_refunds"("organizationId", "createdAt");
CREATE INDEX "platform_refunds_paymentId_idx" ON "platform_refunds"("paymentId");

CREATE TABLE "payment_disputes" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amount" NUMERIC(10,2) NOT NULL,
    "reason" TEXT,
    "status" "PaymentDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "providerReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_disputes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_disputes_organizationId_idx" ON "payment_disputes"("organizationId");

CREATE TABLE "platform_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_webhook_events_provider_providerEventId_key" ON "platform_webhook_events"("provider", "providerEventId");
CREATE INDEX "platform_webhook_events_type_createdAt_idx" ON "platform_webhook_events"("type", "createdAt");

CREATE TABLE "action_center_tasks" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "ActionCenterTaskStatus" NOT NULL DEFAULT 'OPEN',
    "organizationId" TEXT,
    "subscriptionId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminId" TEXT,

    CONSTRAINT "action_center_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "action_center_tasks_status_createdAt_idx" ON "action_center_tasks"("status", "createdAt");
CREATE INDEX "action_center_tasks_organizationId_idx" ON "action_center_tasks"("organizationId");

CREATE TABLE "platform_audit_logs" (
    "id" TEXT NOT NULL,
    "platformAdminId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "previousValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_audit_logs_entityType_entityId_idx" ON "platform_audit_logs"("entityType", "entityId");
CREATE INDEX "platform_audit_logs_createdAt_idx" ON "platform_audit_logs"("createdAt");

-- Single-row config table. "id" has no DEFAULT — application code always
-- upserts the literal id "singleton" (see PlatformBillingConfigService).
CREATE TABLE "platform_billing_config" (
    "id" TEXT NOT NULL,
    "paymentProvider" TEXT,
    "environment" "PlatformBillingEnvironment" NOT NULL DEFAULT 'TEST',
    "connectionStatus" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "recurringBillingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookConfigured" BOOLEAN NOT NULL DEFAULT false,
    "lastSuccessfulWebhookAt" TIMESTAMP(3),
    "lastFailedWebhookAt" TIMESTAMP(3),
    "paymentTestStatus" TEXT,
    "settlementBankName" TEXT,
    "settlementAccountLast4" TEXT,
    "smsNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsNotificationNumber" TEXT,
    "retryIntervalDays" JSONB NOT NULL DEFAULT '[3, 5, 7]',
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" TEXT,

    CONSTRAINT "platform_billing_config_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscription_payment_methods" ADD CONSTRAINT "subscription_payment_methods_billingCustomerId_fkey" FOREIGN KEY ("billingCustomerId") REFERENCES "billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_billingCustomerId_fkey" FOREIGN KEY ("billingCustomerId") REFERENCES "billing_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "subscription_payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "subscription_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_refunds" ADD CONSTRAINT "platform_refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "subscription_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_refunds" ADD CONSTRAINT "platform_refunds_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_refunds" ADD CONSTRAINT "platform_refunds_administratorId_fkey" FOREIGN KEY ("administratorId") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "subscription_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "action_center_tasks" ADD CONSTRAINT "action_center_tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "action_center_tasks" ADD CONSTRAINT "action_center_tasks_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "action_center_tasks" ADD CONSTRAINT "action_center_tasks_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
