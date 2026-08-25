import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError } from '@/lib/utils/api-error';
import { writePlatformAuditLog } from '@/lib/platform-admin/audit';
import { ActionCenterService, TASK_TYPES } from '@/services/platform-billing/ActionCenterService';
import { PlatformAnalyticsConfigService } from './PlatformAnalyticsConfigService';
import { PlatformEventTrackingService, EVENT_TYPES } from './PlatformEventTrackingService';

const PRIORITY_TO_ACTION_PRIORITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

/**
 * Master Data Analytics spec's Customer Support / Complaints module
 * (ADMIN → CUSTOMER SUPPORT → COMPLAINTS). Every complaint auto-creates a
 * linked `ActionCenterTask` in the same transaction (spec's Action Center
 * §20 "Every complaint creates an Action Center item") so complaints
 * surface in the unified queue without a separate notification path.
 * Critical complaints (§22) go straight into the CRITICAL priority bucket,
 * which is what makes them appear under the Action Center's "CRITICAL NOW"
 * section — that section is a `priority=CRITICAL` filter on
 * `ActionCenterService.list`, not a separate table.
 */
export class ComplaintService {
  static async create(params: {
    organizationId: string;
    raisedByUserId?: string;
    category: 'BILLING' | 'TECHNICAL' | 'SERVICE_QUALITY' | 'FEATURE_REQUEST' | 'ACCOUNT' | 'OTHER';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    subject: string;
    description: string;
    slaHours?: number;
  }) {
    const config = await PlatformAnalyticsConfigService.get();
    const slaHours = params.slaHours ?? config.complaintSlaHours;

    return prisma.$transaction(async (tx) => {
      const complaint = await tx.complaint.create({
        data: {
          organizationId: params.organizationId,
          raisedByUserId: params.raisedByUserId,
          category: params.category,
          priority: params.priority,
          subject: params.subject,
          description: params.description,
          slaHours,
        },
      });

      await ActionCenterService.createTask(tx, {
        type: TASK_TYPES.COMPLAINT,
        title: `Complaint: ${params.subject}`,
        description: params.description,
        priority: PRIORITY_TO_ACTION_PRIORITY[params.priority],
        organizationId: params.organizationId,
        complaintId: complaint.id,
        sourceModule: 'complaints',
        dueAt: new Date(Date.now() + slaHours * 3_600_000),
      });

      return complaint;
    }).then(async (complaint) => {
      await PlatformEventTrackingService.track({
        eventType: EVENT_TYPES.COMPLAINT_CREATED,
        organizationId: params.organizationId,
        userId: params.raisedByUserId,
        metadata: { category: params.category, priority: params.priority },
      });
      return complaint;
    });
  }

  static async get(complaintId: string) {
    const complaint = await prisma.complaint.findUnique({
      where: { id: complaintId },
      include: {
        organization: { select: { id: true, name: true } },
        raisedByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignedToAdmin: { select: { id: true, firstName: true, lastName: true } },
        actionCenterTasks: true,
      },
    });
    if (!complaint) throw new NotFoundError('Complaint');
    return complaint;
  }

  static async list(params: {
    status?: 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'WAITING_FOR_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    organizationId?: string;
    limit?: number;
  }) {
    return prisma.complaint.findMany({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.priority ? { priority: params.priority } : {}),
        ...(params.organizationId ? { organizationId: params.organizationId } : {}),
      },
      include: {
        organization: { select: { id: true, name: true } },
        assignedToAdmin: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: params.limit ?? 100,
    });
  }

  static async update(
    complaintId: string,
    actingAdminId: string,
    changes: {
      status?: 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'WAITING_FOR_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
      assignedToAdminId?: string | null;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      resolutionNotes?: string;
    },
  ) {
    const complaint = await prisma.complaint.findUnique({ where: { id: complaintId } });
    if (!complaint) throw new NotFoundError('Complaint');

    return prisma.$transaction(async (tx) => {
      const updated = await tx.complaint.update({
        where: { id: complaintId },
        data: {
          status: changes.status,
          assignedToAdminId: changes.assignedToAdminId,
          priority: changes.priority,
          resolutionNotes: changes.resolutionNotes,
          resolvedAt: changes.status === 'RESOLVED' ? new Date() : undefined,
        },
      });

      // Keep the linked Action Center task's status roughly in step —
      // master spec's "the action center should reflect complaint status".
      if (changes.status === 'RESOLVED' || changes.status === 'CLOSED') {
        await tx.actionCenterTask.updateMany({
          where: { complaintId, status: { notIn: ['RESOLVED', 'CLOSED', 'DISMISSED', 'CANCELLED'] } },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
      }

      await writePlatformAuditLog(tx, {
        platformAdminId: actingAdminId,
        action: 'complaint.update',
        entityType: 'Complaint',
        entityId: complaintId,
        previousValue: { status: complaint.status, priority: complaint.priority, assignedToAdminId: complaint.assignedToAdminId },
        newValue: changes,
      });

      return updated;
    }).then(async (updated) => {
      if (changes.status === 'RESOLVED') {
        await PlatformEventTrackingService.track({
          eventType: EVENT_TYPES.COMPLAINT_RESOLVED,
          organizationId: updated.organizationId,
          metadata: { complaintId: updated.id },
        });
      }
      return updated;
    });
  }

  /**
   * Master spec §21's SLA escalation: any NEW/ASSIGNED/IN_PROGRESS/
   * WAITING_FOR_CUSTOMER complaint older than its `slaHours` gets escalated.
   * Request-triggered (called from the complaints dashboard route and the
   * cron endpoint below) — this codebase has no background job runner, same
   * documented limitation as `SubscriptionRetryService.runDueRetries`.
   */
  static async escalateOverdue() {
    const now = new Date();
    const candidates = await prisma.complaint.findMany({
      where: { status: { in: ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER'] } },
    });

    const overdue = candidates.filter((c) => now.getTime() - c.createdAt.getTime() > c.slaHours * 3_600_000);

    for (const complaint of overdue) {
      await prisma.$transaction(async (tx) => {
        await tx.complaint.update({
          where: { id: complaint.id },
          data: { status: 'ESCALATED', escalatedAt: now },
        });
        await ActionCenterService.createTask(tx, {
          type: TASK_TYPES.COMPLAINT_ESCALATION,
          title: `Complaint SLA breached: ${complaint.subject}`,
          description: `Complaint has been open ${Math.round((now.getTime() - complaint.createdAt.getTime()) / 3_600_000)}h, SLA was ${complaint.slaHours}h.`,
          priority: 'HIGH',
          organizationId: complaint.organizationId,
          complaintId: complaint.id,
          sourceModule: 'complaints',
        });
      });
    }

    return { escalatedCount: overdue.length };
  }

  static async complaintAnalytics(range: { startDate: Date; endDate: Date }) {
    const where = { createdAt: { gte: range.startDate, lte: range.endDate } };
    const [total, resolved, escalated, byCategory, byPriority] = await Promise.all([
      prisma.complaint.count({ where }),
      prisma.complaint.count({ where: { ...where, status: 'RESOLVED' } }),
      prisma.complaint.count({ where: { ...where, status: 'ESCALATED' } }),
      prisma.complaint.groupBy({ by: ['category'], where, _count: { _all: true } }),
      prisma.complaint.groupBy({ by: ['priority'], where, _count: { _all: true } }),
    ]);

    const resolvedComplaints = await prisma.complaint.findMany({
      where: { ...where, resolvedAt: { not: null } },
      select: { createdAt: true, resolvedAt: true },
    });
    const avgResolutionHours =
      resolvedComplaints.length > 0
        ? resolvedComplaints.reduce((sum, c) => sum + (c.resolvedAt!.getTime() - c.createdAt.getTime()) / 3_600_000, 0) /
          resolvedComplaints.length
        : 0;

    return {
      total,
      resolved,
      escalated,
      resolutionRate: total > 0 ? Number(((resolved / total) * 100).toFixed(1)) : 0,
      averageResolutionHours: Number(avgResolutionHours.toFixed(1)),
      byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r._count._all])),
      byPriority: Object.fromEntries(byPriority.map((r) => [r.priority, r._count._all])),
    };
  }
}
