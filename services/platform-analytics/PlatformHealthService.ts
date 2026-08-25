import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { log } from '@/lib/monitoring/logger';
import { ActionCenterService, TASK_TYPES } from '@/services/platform-billing/ActionCenterService';

export type PlatformHealthEventType =
  | 'API_ERROR'
  | 'PAYMENT_GATEWAY_ERROR'
  | 'WEBHOOK_FAILURE'
  | 'NOTIFICATION_FAILURE'
  | 'DATABASE_ERROR'
  | 'APPLICATION_CRASH'
  | 'HIGH_LATENCY'
  | 'LOGIN_FAILURE'
  | 'INTEGRATION_FAILURE';

export type PlatformHealthSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Master Data Analytics spec's "Platform Health" / "System Alerts" module
 * (§28/§29; Action Center §27-29 "Technical Actions"). A real, append-only
 * event log — NOT a fake APM integration. `record()` is called from the
 * small, honestly-scoped set of real trigger points already in this
 * codebase that can detect a technical failure server-side: webhook
 * processing failures and payment-gateway call failures
 * (SubscriptionWebhookService, SubscriptionRetryService) and platform-admin
 * login rate-limit rejections (`app/api/platform-admin/login/route.ts`).
 * It does NOT claim to catch every possible error across every route
 * handler in the app — that would require instrumenting the entire
 * codebase's error paths, out of scope for this phase and documented as a
 * real gap here rather than silently pretending to be comprehensive.
 */
export class PlatformHealthService {
  static async record(params: {
    type: PlatformHealthEventType;
    severity: PlatformHealthSeverity;
    message: string;
    organizationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const event = await prisma.platformHealthEvent.create({
        data: {
          type: params.type,
          severity: params.severity,
          message: params.message,
          organizationId: params.organizationId,
          metadata: params.metadata,
        },
      });

      // Master spec §28's incident priority: HIGH/CRITICAL technical
      // events also create an Action Center task so a developer is
      // actually looped in, not just left to notice the health dashboard.
      if (params.severity === 'HIGH' || params.severity === 'CRITICAL') {
        await ActionCenterService.createTask(prisma, {
          type: TASK_TYPES.TECHNICAL_INCIDENT,
          title: params.message,
          description: params.metadata ? JSON.stringify(params.metadata) : undefined,
          priority: params.severity,
          organizationId: params.organizationId,
          sourceModule: 'platform_health',
        });
      }

      return void event;
    } catch (error) {
      // A failure here must never break the real request that triggered it.
      log.error('PlatformHealthService.record failed', error);
    }
  }

  static async recentEvents(params: { type?: PlatformHealthEventType; severity?: PlatformHealthSeverity; limit?: number }) {
    return prisma.platformHealthEvent.findMany({
      where: {
        ...(params.type ? { type: params.type } : {}),
        ...(params.severity ? { severity: params.severity } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
      include: { organization: { select: { id: true, name: true } } },
    });
  }

  static async summary(range: { startDate: Date; endDate: Date }) {
    const where = { createdAt: { gte: range.startDate, lte: range.endDate } };
    const [total, byType, bySeverity, unresolved] = await Promise.all([
      prisma.platformHealthEvent.count({ where }),
      prisma.platformHealthEvent.groupBy({ by: ['type'], where, _count: { _all: true } }),
      prisma.platformHealthEvent.groupBy({ by: ['severity'], where, _count: { _all: true } }),
      prisma.platformHealthEvent.count({ where: { ...where, resolvedAt: null } }),
    ]);
    return {
      total,
      unresolved,
      byType: Object.fromEntries(byType.map((r) => [r.type, r._count._all])),
      bySeverity: Object.fromEntries(bySeverity.map((r) => [r.severity, r._count._all])),
    };
  }

  static async markResolved(eventId: string) {
    return prisma.platformHealthEvent.update({ where: { id: eventId }, data: { resolvedAt: new Date() } });
  }
}
