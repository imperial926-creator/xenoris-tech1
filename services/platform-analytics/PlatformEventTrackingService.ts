import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { log } from '@/lib/monitoring/logger';

/**
 * Master Data Analytics spec's standardized event-tracking system: named
 * events (`restaurant.created`, `subscription.payment_succeeded`,
 * `complaint.resolved`, `feature.used`, etc.) written to
 * `PlatformAnalyticsEvent`. Best-effort and off the request path — a
 * tracking failure must never break the real action that triggered it, so
 * `track()` swallows its own errors after logging them (same discipline
 * `CustomerAnalyticsService.logEvent` already uses for CAPP Phase 11's
 * event log).
 *
 * This phase instruments a deliberately honest, bounded set of real
 * trigger points (see the call sites in SubscriptionWebhookService,
 * SubscriptionService, ComplaintService, ActionCenterService) rather than
 * claiming every one of the ~20 named features across the whole
 * application emits an event — wiring literally every route handler in
 * this codebase is out of scope for this phase. `EVENT_TYPES` documents
 * exactly which ones are real.
 */
export const EVENT_TYPES = {
  RESTAURANT_REGISTERED: 'restaurant.registered',
  SUBSCRIPTION_ACTIVATED: 'subscription.activated',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  PAYMENT_SUCCEEDED: 'subscription.payment_succeeded',
  PAYMENT_FAILED: 'subscription.payment_failed',
  COMPLAINT_CREATED: 'complaint.created',
  COMPLAINT_RESOLVED: 'complaint.resolved',
  ACTION_CENTER_TASK_RESOLVED: 'action_center.task_resolved',
  PLATFORM_ADMIN_LOGIN: 'platform_admin.login',
} as const;
export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export class PlatformEventTrackingService {
  static async track(params: {
    eventType: EventType | string;
    organizationId?: string;
    userId?: string;
    subscriptionId?: string;
    customerAccountId?: string;
    planId?: string;
    sessionId?: string;
    source?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await prisma.platformAnalyticsEvent.create({
        data: {
          eventType: params.eventType,
          organizationId: params.organizationId,
          userId: params.userId,
          subscriptionId: params.subscriptionId,
          customerAccountId: params.customerAccountId,
          planId: params.planId,
          sessionId: params.sessionId,
          source: params.source,
          metadata: params.metadata,
        },
      });
    } catch (error) {
      log.error('PlatformEventTrackingService.track failed', error);
    }
  }

  static async countByType(eventType: string, range: { startDate: Date; endDate: Date }) {
    return prisma.platformAnalyticsEvent.count({
      where: { eventType, occurredAt: { gte: range.startDate, lte: range.endDate } },
    });
  }

  static async eventTypeBreakdown(range: { startDate: Date; endDate: Date }) {
    const rows = await prisma.platformAnalyticsEvent.groupBy({
      by: ['eventType'],
      where: { occurredAt: { gte: range.startDate, lte: range.endDate } },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.eventType, r._count._all]));
  }
}
