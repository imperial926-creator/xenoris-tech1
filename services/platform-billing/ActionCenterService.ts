import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError } from '@/lib/utils/api-error';
import { writePlatformAuditLog } from '@/lib/platform-admin/audit';

/**
 * The FIRST implementation of "Action Center" anywhere in this codebase —
 * see the big comment above the `ActionCenterTask` model in schema.prisma
 * for why (master spec references it ~15 times across earlier phases as
 * though it already existed; it did not). Phase 17 scoped this to
 * billing-triggered tasks only; Phase 18 (the Data Analytics + Action
 * Center master spec) turns it into the platform's single, unified
 * operational queue — every module below (`FOLLOW_UP`, `COMPLAINT`,
 * `TECHNICAL_*`, etc.) creates/updates rows in this SAME table, per that
 * spec's own explicit "the Action Center must not merely be a notification
 * list" / duplicate-prevention (§60/§61) requirements, which only make
 * sense with one task table to check against. `type` stays a plain string
 * catalog (see `TASK_TYPES`) rather than a DB enum for the same reason
 * Phase 17 chose that: a later module can add its own task types without a
 * migration touching this table.
 */
export const TASK_TYPES = {
  // Phase 17 — billing
  FAILED_PAYMENT: 'FAILED_PAYMENT',
  REPEATED_FAILED_PAYMENT: 'REPEATED_FAILED_PAYMENT',
  PAYMENT_RECOVERED: 'PAYMENT_RECOVERED',
  SUBSCRIPTION_SUSPENDED: 'SUBSCRIPTION_SUSPENDED',
  SUBSCRIPTION_CANCELLATION: 'SUBSCRIPTION_CANCELLATION',
  REFUND: 'REFUND',
  PAYMENT_DISPUTE: 'PAYMENT_DISPUTE',
  GATEWAY_FAILURE: 'GATEWAY_FAILURE',
  WEBHOOK_FAILURE: 'WEBHOOK_FAILURE',
  SETTLEMENT_DISCREPANCY: 'SETTLEMENT_DISCREPANCY',
  // Phase 18 — Data Analytics + Action Center master spec §7's catalog
  SUBSCRIPTION_RENEWAL: 'SUBSCRIPTION_RENEWAL',
  UPGRADE_OPPORTUNITY: 'UPGRADE_OPPORTUNITY',
  DOWNGRADE_RISK: 'DOWNGRADE_RISK',
  CHURN_RISK: 'CHURN_RISK',
  COMPLAINT: 'COMPLAINT',
  COMPLAINT_ESCALATION: 'COMPLAINT_ESCALATION',
  ONBOARDING_INCOMPLETE: 'ONBOARDING_INCOMPLETE',
  INACTIVE_RESTAURANT: 'INACTIVE_RESTAURANT',
  FEATURE_ADOPTION: 'FEATURE_ADOPTION',
  TECHNICAL_INCIDENT: 'TECHNICAL_INCIDENT',
  SYSTEM_ALERT: 'SYSTEM_ALERT',
  SALES_FOLLOW_UP: 'SALES_FOLLOW_UP',
  GENERAL_TASK: 'GENERAL_TASK',
} as const;
export type TaskType = (typeof TASK_TYPES)[keyof typeof TASK_TYPES];

// Task types the spec's §60/§61 "duplicate prevention" applies to: types
// that represent an ONGOING condition for a given organization, where a
// second open task for the same (type, organizationId) pair should update
// the existing row instead of creating a new one. Types that represent a
// discrete EVENT (a specific refund, a specific dispute) are intentionally
// excluded — two refunds for the same restaurant are two real tasks.
const DEDUPE_ON_ORGANIZATION: ReadonlySet<TaskType> = new Set([
  TASK_TYPES.FAILED_PAYMENT,
  TASK_TYPES.REPEATED_FAILED_PAYMENT,
  TASK_TYPES.SUBSCRIPTION_SUSPENDED,
  TASK_TYPES.SUBSCRIPTION_RENEWAL,
  TASK_TYPES.UPGRADE_OPPORTUNITY,
  TASK_TYPES.DOWNGRADE_RISK,
  TASK_TYPES.CHURN_RISK,
  TASK_TYPES.ONBOARDING_INCOMPLETE,
  TASK_TYPES.INACTIVE_RESTAURANT,
  TASK_TYPES.FEATURE_ADOPTION,
]);

const OPEN_STATUSES = ['OPEN', 'NEW', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'FOLLOW_UP_REQUIRED', 'ESCALATED'] as const;

export type ActionPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ActionCenterTaskStatusValue =
  | 'OPEN'
  | 'NEW'
  | 'ACKNOWLEDGED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'WAITING'
  | 'FOLLOW_UP_REQUIRED'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'CLOSED'
  | 'DISMISSED'
  | 'CANCELLED';

export class ActionCenterService {
  /**
   * Creates an OPEN task, UNLESS an open task of the same dedupe-eligible
   * type already exists for this organization (master spec §61) — in that
   * case the existing task's `description`/`priority`/metadata are updated
   * in place instead (e.g. bumping a retry count) and no duplicate row is
   * created. Accepts an optional transaction client so callers
   * (SubscriptionWebhookService, SubscriptionRetryService, ComplaintService,
   * EngagementScoreService) can create the task atomically alongside the
   * state change that triggered it.
   */
  static async createTask(
    client: PrismaClient | Prisma.TransactionClient,
    params: {
      type: TaskType;
      title: string;
      description?: string;
      priority?: ActionPriority;
      organizationId?: string;
      subscriptionId?: string;
      complaintId?: string;
      sourceModule?: string;
      revenueImpact?: number | string;
      dueAt?: Date;
    },
  ) {
    if (params.organizationId && DEDUPE_ON_ORGANIZATION.has(params.type)) {
      const existing = await client.actionCenterTask.findFirst({
        where: {
          type: params.type,
          organizationId: params.organizationId,
          status: { in: [...OPEN_STATUSES] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        return client.actionCenterTask.update({
          where: { id: existing.id },
          data: {
            title: params.title,
            description: params.description ?? existing.description,
            priority: params.priority ?? existing.priority,
            revenueImpact: params.revenueImpact ?? existing.revenueImpact ?? undefined,
            dueAt: params.dueAt ?? existing.dueAt,
          },
        });
      }
    }

    return client.actionCenterTask.create({
      data: {
        type: params.type,
        title: params.title,
        description: params.description,
        priority: params.priority ?? 'MEDIUM',
        organizationId: params.organizationId,
        subscriptionId: params.subscriptionId,
        complaintId: params.complaintId,
        sourceModule: params.sourceModule,
        revenueImpact: params.revenueImpact,
        dueAt: params.dueAt,
      },
    });
  }

  static async get(taskId: string) {
    const task = await prisma.actionCenterTask.findUnique({
      where: { id: taskId },
      include: {
        organization: { select: { id: true, name: true } },
        subscription: { select: { id: true, status: true, planId: true } },
        assignedAdmin: { select: { id: true, firstName: true, lastName: true } },
        resolvedByAdmin: { select: { id: true, firstName: true, lastName: true } },
        complaint: { select: { id: true, subject: true, category: true, status: true } },
        notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });
    if (!task) throw new NotFoundError('Action Center task');
    return task;
  }

  static async list(params: {
    status?: ActionCenterTaskStatusValue;
    type?: string;
    priority?: ActionPriority;
    assignedToAdminId?: string;
    organizationId?: string;
    overdue?: boolean;
    limit?: number;
  }) {
    const where: Prisma.ActionCenterTaskWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.type ? { type: params.type } : {}),
      ...(params.priority ? { priority: params.priority } : {}),
      ...(params.assignedToAdminId ? { assignedToAdminId: params.assignedToAdminId } : {}),
      ...(params.organizationId ? { organizationId: params.organizationId } : {}),
      ...(params.overdue
        ? { dueAt: { lt: new Date() }, status: { in: [...OPEN_STATUSES] } }
        : {}),
    };

    return prisma.actionCenterTask.findMany({
      where,
      include: {
        organization: { select: { id: true, name: true } },
        subscription: { select: { id: true, status: true, planId: true } },
        assignedAdmin: { select: { id: true, firstName: true, lastName: true } },
        complaint: { select: { id: true, subject: true, category: true } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: params.limit ?? 100,
    });
  }

  /** Master spec §2's Action Center dashboard header counts. */
  static async dashboardCounts() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 86_400_000);

    const [total, critical, high, medium, low, dueToday, overdue, unassigned, inProgress, completedToday, escalated] =
      await Promise.all([
        prisma.actionCenterTask.count({ where: { status: { in: [...OPEN_STATUSES] } } }),
        prisma.actionCenterTask.count({ where: { status: { in: [...OPEN_STATUSES] }, priority: 'CRITICAL' } }),
        prisma.actionCenterTask.count({ where: { status: { in: [...OPEN_STATUSES] }, priority: 'HIGH' } }),
        prisma.actionCenterTask.count({ where: { status: { in: [...OPEN_STATUSES] }, priority: 'MEDIUM' } }),
        prisma.actionCenterTask.count({ where: { status: { in: [...OPEN_STATUSES] }, priority: 'LOW' } }),
        prisma.actionCenterTask.count({
          where: { status: { in: [...OPEN_STATUSES] }, dueAt: { gte: startOfToday, lt: endOfToday } },
        }),
        prisma.actionCenterTask.count({ where: { status: { in: [...OPEN_STATUSES] }, dueAt: { lt: now } } }),
        prisma.actionCenterTask.count({ where: { status: { in: [...OPEN_STATUSES] }, assignedToAdminId: null } }),
        prisma.actionCenterTask.count({ where: { status: 'IN_PROGRESS' } }),
        prisma.actionCenterTask.count({ where: { resolvedAt: { gte: startOfToday, lt: endOfToday } } }),
        prisma.actionCenterTask.count({ where: { status: 'ESCALATED' } }),
      ]);

    return { total, critical, high, medium, low, dueToday, overdue, unassigned, inProgress, completedToday, escalated };
  }

  /** Master spec §40's "Today's Action Briefing" — top priorities by priority then revenue impact. */
  static async dailyBriefing(limit = 5) {
    const counts = await this.dashboardCounts();
    const topPriorities = await prisma.actionCenterTask.findMany({
      where: { status: { in: [...OPEN_STATUSES] } },
      include: { organization: { select: { name: true } } },
      orderBy: [{ priority: 'desc' }, { revenueImpact: 'desc' }, { createdAt: 'asc' }],
      take: limit,
    });
    return { counts, topPriorities };
  }

  static async assign(taskId: string, assignedToAdminId: string | null, actingAdminId: string) {
    const task = await prisma.actionCenterTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Action Center task');

    return prisma.$transaction(async (tx) => {
      const updated = await tx.actionCenterTask.update({
        where: { id: taskId },
        data: {
          assignedToAdminId,
          status: assignedToAdminId && task.status === 'OPEN' ? 'ASSIGNED' : task.status,
        },
      });
      await writePlatformAuditLog(tx, {
        platformAdminId: actingAdminId,
        action: 'action_center.assign',
        entityType: 'ActionCenterTask',
        entityId: taskId,
        previousValue: { assignedToAdminId: task.assignedToAdminId },
        newValue: { assignedToAdminId },
      });
      return updated;
    });
  }

  static async addNote(taskId: string, authorAdminId: string, note: string) {
    const task = await prisma.actionCenterTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Action Center task');

    return prisma.$transaction(async (tx) => {
      const created = await tx.actionCenterNote.create({
        data: { taskId, authorAdminId, note },
      });
      await tx.actionCenterTask.update({
        where: { id: taskId },
        data: { lastFollowUpAt: new Date() },
      });
      return created;
    });
  }

  static async scheduleFollowUp(taskId: string, nextFollowUpAt: Date, followUpMethod: string) {
    const task = await prisma.actionCenterTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Action Center task');
    return prisma.actionCenterTask.update({
      where: { id: taskId },
      data: { nextFollowUpAt, followUpMethod, status: task.status === 'OPEN' ? 'FOLLOW_UP_REQUIRED' : task.status },
    });
  }

  /**
   * Master spec §63's configurable escalation — moves status to ESCALATED
   * and bumps priority one level, capped at CRITICAL.
   */
  static async escalate(taskId: string, actingAdminId: string, reason?: string) {
    const task = await prisma.actionCenterTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Action Center task');

    const ESCALATION_ORDER: ActionPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const currentIndex = ESCALATION_ORDER.indexOf(task.priority as ActionPriority);
    const nextPriority = ESCALATION_ORDER[Math.min(currentIndex + 1, ESCALATION_ORDER.length - 1)];

    return prisma.$transaction(async (tx) => {
      const updated = await tx.actionCenterTask.update({
        where: { id: taskId },
        data: { status: 'ESCALATED', priority: nextPriority },
      });
      await writePlatformAuditLog(tx, {
        platformAdminId: actingAdminId,
        action: 'action_center.escalate',
        entityType: 'ActionCenterTask',
        entityId: taskId,
        previousValue: { status: task.status, priority: task.priority },
        newValue: { status: 'ESCALATED', priority: nextPriority, reason },
      });
      return updated;
    });
  }

  /**
   * Updates status (§5's fuller lifecycle). RESOLVED/CLOSED set the
   * relevant timestamp; any other status change is recorded, but only
   * RESOLVED/CLOSED require `resolutionNotes` to be meaningful in
   * practice — enforced at the route/Zod layer, not here, since some
   * transitions (ACKNOWLEDGED, IN_PROGRESS) legitimately have none yet.
   */
  static async updateStatus(
    taskId: string,
    status: ActionCenterTaskStatusValue,
    actingAdminId: string,
    resolutionNotes?: string,
  ) {
    const task = await prisma.actionCenterTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Action Center task');

    const now = new Date();
    const data: Prisma.ActionCenterTaskUpdateInput = { status };
    if (status === 'RESOLVED') {
      data.resolvedAt = now;
      data.resolvedByAdmin = { connect: { id: actingAdminId } };
      if (resolutionNotes) data.resolutionNotes = resolutionNotes;
    }
    if (status === 'CLOSED') {
      data.closedAt = now;
      if (resolutionNotes) data.resolutionNotes = resolutionNotes;
    }
    if (status === 'IN_PROGRESS' && !task.startedAt) {
      data.startedAt = now;
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.actionCenterTask.update({ where: { id: taskId }, data });
      await writePlatformAuditLog(tx, {
        platformAdminId: actingAdminId,
        action: 'action_center.status_change',
        entityType: 'ActionCenterTask',
        entityId: taskId,
        previousValue: { status: task.status },
        newValue: { status, resolutionNotes },
      });
      return updated;
    });
  }

  /** Back-compat alias for the Phase 17 call sites — resolve() == updateStatus('RESOLVED'). */
  static async resolve(taskId: string, platformAdminId: string, resolutionNote?: string) {
    return this.updateStatus(taskId, 'RESOLVED', platformAdminId, resolutionNote);
  }

  /**
   * Auto-close: called by the module whose triggering condition just
   * resolved (e.g. SubscriptionWebhookService.handlePaymentSucceeded after
   * a FAILED_PAYMENT task's payment recovers) — master spec §62.
   */
  static async autoResolveOpenTasksForOrganization(
    client: PrismaClient | Prisma.TransactionClient,
    organizationId: string,
    type: TaskType,
  ) {
    return client.actionCenterTask.updateMany({
      where: { organizationId, type, status: { in: [...OPEN_STATUSES] } },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }

  /** Master spec §52/§53/§54's Action Analytics + staff performance + effectiveness. */
  static async actionAnalytics(range: { startDate: Date; endDate: Date }) {
    const where = { createdAt: { gte: range.startDate, lte: range.endDate } };
    const [created, resolved, overdue, escalated, byPriority] = await Promise.all([
      prisma.actionCenterTask.count({ where }),
      prisma.actionCenterTask.count({ where: { ...where, status: 'RESOLVED' } }),
      prisma.actionCenterTask.count({ where: { ...where, status: { in: [...OPEN_STATUSES] }, dueAt: { lt: new Date() } } }),
      prisma.actionCenterTask.count({ where: { ...where, status: 'ESCALATED' } }),
      prisma.actionCenterTask.groupBy({ by: ['priority'], where, _count: { _all: true } }),
    ]);

    const resolvedTasks = await prisma.actionCenterTask.findMany({
      where: { ...where, status: 'RESOLVED', resolvedAt: { not: null } },
      select: { createdAt: true, resolvedAt: true },
    });
    const avgResolutionHours =
      resolvedTasks.length > 0
        ? resolvedTasks.reduce((sum, t) => sum + (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3_600_000, 0) /
          resolvedTasks.length
        : 0;

    return {
      created,
      resolved,
      overdue,
      escalated,
      resolutionRate: created > 0 ? Number(((resolved / created) * 100).toFixed(1)) : 0,
      averageResolutionHours: Number(avgResolutionHours.toFixed(1)),
      byPriority: Object.fromEntries(byPriority.map((r) => [r.priority, r._count._all])),
    };
  }

  /**
   * Master spec §53's staff performance — explicitly warns against raw
   * counts as the sole measure, so this returns the underlying figures
   * (assigned/completed/overdue/avg resolution time) for the UI to present
   * alongside priority/complexity context, rather than a single ranked
   * "score" this service would have to invent.
   */
  static async staffPerformance(adminId: string, range: { startDate: Date; endDate: Date }) {
    const where = { assignedToAdminId: adminId, createdAt: { gte: range.startDate, lte: range.endDate } };
    const [assigned, completed, overdue] = await Promise.all([
      prisma.actionCenterTask.count({ where }),
      prisma.actionCenterTask.count({ where: { ...where, status: 'RESOLVED' } }),
      prisma.actionCenterTask.count({ where: { ...where, status: { in: [...OPEN_STATUSES] }, dueAt: { lt: new Date() } } }),
    ]);
    return { assigned, completed, overdue };
  }
}
