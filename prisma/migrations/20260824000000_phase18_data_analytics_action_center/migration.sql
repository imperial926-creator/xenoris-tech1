-- Phase 18 — Data Analytics & Business Intelligence + Action Center Extension.
-- See the large comment block in schema.prisma immediately above the
-- "Phase 18" section header for full architectural rationale. This
-- migration is additive except for two EXTENSIONS of existing Phase 17
-- tables (widening "ActionCenterTaskStatus", adding columns to
-- "action_center_tasks" and "platform_admins") — no existing column is
-- dropped, renamed, or narrowed, and every new NOT NULL column carries a
-- DEFAULT so existing rows remain valid without a manual backfill.
--
-- NOTE ON "ALTER TYPE ... ADD VALUE": each statement below runs on its own
-- (this file is applied via `psql -f`, i.e. autocommit per statement, not
-- wrapped in one BEGIN/COMMIT) — Postgres forbids using a freshly added
-- enum value in the same transaction that added it, which is why the new
-- ActionCenterTaskStatus values are added first, standalone, before any
-- table below references them.

-- ---------------------------------------------------------------------------
-- Widen existing enum (Phase 17 -> Phase 18)
-- ---------------------------------------------------------------------------

ALTER TYPE "ActionCenterTaskStatus" ADD VALUE 'NEW';
ALTER TYPE "ActionCenterTaskStatus" ADD VALUE 'ACKNOWLEDGED';
ALTER TYPE "ActionCenterTaskStatus" ADD VALUE 'ASSIGNED';
ALTER TYPE "ActionCenterTaskStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "ActionCenterTaskStatus" ADD VALUE 'WAITING';
ALTER TYPE "ActionCenterTaskStatus" ADD VALUE 'FOLLOW_UP_REQUIRED';
ALTER TYPE "ActionCenterTaskStatus" ADD VALUE 'ESCALATED';
ALTER TYPE "ActionCenterTaskStatus" ADD VALUE 'CLOSED';
ALTER TYPE "ActionCenterTaskStatus" ADD VALUE 'DISMISSED';
ALTER TYPE "ActionCenterTaskStatus" ADD VALUE 'CANCELLED';

-- ---------------------------------------------------------------------------
-- New enums
-- ---------------------------------------------------------------------------

CREATE TYPE "ActionPriority" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
);

CREATE TYPE "PlatformAdminRole" AS ENUM (
    'SUPER_ADMIN',
    'FINANCE_ADMIN',
    'SUPPORT_ADMIN',
    'SALES_ADMIN',
    'ANALYTICS_ADMIN',
    'DEVELOPER',
    'AUDITOR'
);

CREATE TYPE "RestaurantLifecycleState" AS ENUM (
    'REGISTERED',
    'ONBOARDING',
    'TRIAL',
    'ACTIVE',
    'PAST_DUE',
    'GRACE_PERIOD',
    'SUSPENDED',
    'CANCELLED',
    'REACTIVATED',
    'EXPIRED'
);

CREATE TYPE "MrrMovementType" AS ENUM (
    'NEW',
    'EXPANSION',
    'CONTRACTION',
    'CHURNED',
    'REACTIVATION'
);

CREATE TYPE "ComplaintCategory" AS ENUM (
    'BILLING',
    'TECHNICAL',
    'SERVICE_QUALITY',
    'FEATURE_REQUEST',
    'ACCOUNT',
    'OTHER'
);

CREATE TYPE "ComplaintPriority" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
);

CREATE TYPE "ComplaintStatus" AS ENUM (
    'NEW',
    'ASSIGNED',
    'IN_PROGRESS',
    'WAITING_FOR_CUSTOMER',
    'ESCALATED',
    'RESOLVED',
    'CLOSED'
);

CREATE TYPE "PlatformHealthEventType" AS ENUM (
    'API_ERROR',
    'PAYMENT_GATEWAY_ERROR',
    'WEBHOOK_FAILURE',
    'NOTIFICATION_FAILURE',
    'DATABASE_ERROR',
    'APPLICATION_CRASH',
    'HIGH_LATENCY',
    'LOGIN_FAILURE',
    'INTEGRATION_FAILURE'
);

CREATE TYPE "PlatformHealthSeverity" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
);

-- ---------------------------------------------------------------------------
-- Extend "platform_admins" (Phase 17 table)
-- ---------------------------------------------------------------------------

ALTER TABLE "platform_admins" ADD COLUMN "role" "PlatformAdminRole" NOT NULL DEFAULT 'SUPER_ADMIN';

-- ---------------------------------------------------------------------------
-- Extend "action_center_tasks" (Phase 17 table)
-- ---------------------------------------------------------------------------

ALTER TABLE "action_center_tasks" ADD COLUMN "priority" "ActionPriority" NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "action_center_tasks" ADD COLUMN "complaintId" TEXT;
ALTER TABLE "action_center_tasks" ADD COLUMN "sourceModule" TEXT;
ALTER TABLE "action_center_tasks" ADD COLUMN "revenueImpact" NUMERIC(10,2);
ALTER TABLE "action_center_tasks" ADD COLUMN "assignedToAdminId" TEXT;
ALTER TABLE "action_center_tasks" ADD COLUMN "dueAt" TIMESTAMP(3);
ALTER TABLE "action_center_tasks" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "action_center_tasks" ADD COLUMN "lastFollowUpAt" TIMESTAMP(3);
ALTER TABLE "action_center_tasks" ADD COLUMN "nextFollowUpAt" TIMESTAMP(3);
ALTER TABLE "action_center_tasks" ADD COLUMN "followUpMethod" TEXT;
ALTER TABLE "action_center_tasks" ADD COLUMN "resolutionNotes" TEXT;
ALTER TABLE "action_center_tasks" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "action_center_tasks" ADD COLUMN "closedAt" TIMESTAMP(3);

CREATE INDEX "action_center_tasks_priority_status_idx" ON "action_center_tasks"("priority", "status");
CREATE INDEX "action_center_tasks_assignedToAdminId_status_idx" ON "action_center_tasks"("assignedToAdminId", "status");
CREATE INDEX "action_center_tasks_dueAt_idx" ON "action_center_tasks"("dueAt");

-- ---------------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------------

CREATE TABLE "action_center_notes" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorAdminId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_center_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "action_center_notes_taskId_createdAt_idx" ON "action_center_notes"("taskId", "createdAt");

CREATE TABLE "restaurant_lifecycle_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "state" "RestaurantLifecycleState" NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_lifecycle_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "restaurant_lifecycle_events_organizationId_enteredAt_idx" ON "restaurant_lifecycle_events"("organizationId", "enteredAt");
CREATE INDEX "restaurant_lifecycle_events_state_enteredAt_idx" ON "restaurant_lifecycle_events"("state", "enteredAt");

CREATE TABLE "mrr_movement_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" "MrrMovementType" NOT NULL,
    "amount" NUMERIC(10,2) NOT NULL,
    "previousPlanId" TEXT,
    "newPlanId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mrr_movement_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mrr_movement_events_organizationId_occurredAt_idx" ON "mrr_movement_events"("organizationId", "occurredAt");
CREATE INDEX "mrr_movement_events_type_occurredAt_idx" ON "mrr_movement_events"("type", "occurredAt");

CREATE TABLE "complaints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "raisedByUserId" TEXT,
    "category" "ComplaintCategory" NOT NULL,
    "priority" "ComplaintPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ComplaintStatus" NOT NULL DEFAULT 'NEW',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assignedToAdminId" TEXT,
    "slaHours" INTEGER NOT NULL DEFAULT 24,
    "escalatedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "complaints_organizationId_createdAt_idx" ON "complaints"("organizationId", "createdAt");
CREATE INDEX "complaints_status_priority_idx" ON "complaints"("status", "priority");

CREATE TABLE "platform_health_events" (
    "id" TEXT NOT NULL,
    "type" "PlatformHealthEventType" NOT NULL,
    "severity" "PlatformHealthSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "organizationId" TEXT,
    "metadata" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_health_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_health_events_type_createdAt_idx" ON "platform_health_events"("type", "createdAt");
CREATE INDEX "platform_health_events_severity_createdAt_idx" ON "platform_health_events"("severity", "createdAt");

CREATE TABLE "platform_alert_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "comparisonOperator" TEXT NOT NULL,
    "thresholdValue" NUMERIC(12,2) NOT NULL,
    "severity" "PlatformHealthSeverity" NOT NULL DEFAULT 'MEDIUM',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_alert_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_analytics_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "subscriptionId" TEXT,
    "customerAccountId" TEXT,
    "planId" TEXT,
    "sessionId" TEXT,
    "source" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_analytics_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_analytics_events_eventType_occurredAt_idx" ON "platform_analytics_events"("eventType", "occurredAt");
CREATE INDEX "platform_analytics_events_organizationId_occurredAt_idx" ON "platform_analytics_events"("organizationId", "occurredAt");

CREATE TABLE "restaurant_engagement_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "classification" TEXT NOT NULL,
    "breakdown" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_engagement_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "restaurant_engagement_snapshots_organizationId_computedAt_idx" ON "restaurant_engagement_snapshots"("organizationId", "computedAt");

CREATE TABLE "platform_analytics_config" (
    "id" TEXT NOT NULL,
    "engagementWeights" JSONB NOT NULL DEFAULT '{"login":20,"orders":25,"reservations":15,"customerGrowth":15,"promotions":10,"loyalty":5,"featureAdoption":10}',
    "anomalyThresholdPercent" INTEGER NOT NULL DEFAULT 30,
    "complaintSlaHours" INTEGER NOT NULL DEFAULT 24,
    "renewalReminderDays" JSONB NOT NULL DEFAULT '[30, 14, 7, 3, 1]',
    "inactivityDaysThreshold" INTEGER NOT NULL DEFAULT 14,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" TEXT,

    CONSTRAINT "platform_analytics_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "saved_reports" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdByAdminId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "scheduleCron" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saved_reports_createdByAdminId_idx" ON "saved_reports"("createdByAdminId");

CREATE TABLE "platform_export_logs" (
    "id" TEXT NOT NULL,
    "platformAdminId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filters" JSONB,
    "rowCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_export_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_export_logs_platformAdminId_createdAt_idx" ON "platform_export_logs"("platformAdminId", "createdAt");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

ALTER TABLE "action_center_tasks" ADD CONSTRAINT "action_center_tasks_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "action_center_tasks" ADD CONSTRAINT "action_center_tasks_assignedToAdminId_fkey" FOREIGN KEY ("assignedToAdminId") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "action_center_notes" ADD CONSTRAINT "action_center_notes_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "action_center_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "action_center_notes" ADD CONSTRAINT "action_center_notes_authorAdminId_fkey" FOREIGN KEY ("authorAdminId") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "restaurant_lifecycle_events" ADD CONSTRAINT "restaurant_lifecycle_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mrr_movement_events" ADD CONSTRAINT "mrr_movement_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mrr_movement_events" ADD CONSTRAINT "mrr_movement_events_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "complaints" ADD CONSTRAINT "complaints_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_raisedByUserId_fkey" FOREIGN KEY ("raisedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_assignedToAdminId_fkey" FOREIGN KEY ("assignedToAdminId") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_health_events" ADD CONSTRAINT "platform_health_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_analytics_events" ADD CONSTRAINT "platform_analytics_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "restaurant_engagement_snapshots" ADD CONSTRAINT "restaurant_engagement_snapshots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_export_logs" ADD CONSTRAINT "platform_export_logs_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
