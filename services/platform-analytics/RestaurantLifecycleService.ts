import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export type LifecycleState =
  | 'REGISTERED'
  | 'ONBOARDING'
  | 'TRIAL'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'GRACE_PERIOD'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'REACTIVATED'
  | 'EXPIRED';

/**
 * Master Data Analytics spec §14's restaurant lifecycle (REGISTERED →
 * ONBOARDING → TRIAL → ACTIVE → PAST_DUE → GRACE_PERIOD → SUSPENDED →
 * CANCELLED → REACTIVATED → EXPIRED). This is a HISTORY log, additive
 * alongside `Subscription.status` (Phase 17's live state machine) rather
 * than a replacement for it — see the big Phase 18 header comment in
 * schema.prisma for the full reasoning. Callers (SubscriptionService,
 * SubscriptionWebhookService, SubscriptionRetryService) call
 * `transition()` at the exact same points they already change
 * `Subscription.status`, inside the same transaction.
 */
export class RestaurantLifecycleService {
  /**
   * Closes out the organization's currently-open lifecycle event (if any,
   * by setting `exitedAt`) and opens a new one in `state`. Idempotent
   * against accidental double-calls with the same state: if the most
   * recent open event is already in `state`, this is a no-op (avoids a
   * meaningless zero-duration entry/exit pair when a caller re-fires the
   * same transition, e.g. a webhook redelivery that the idempotency guard
   * already no-op'd upstream but which still reaches this call).
   */
  static async transition(
    client: PrismaClient | Prisma.TransactionClient,
    params: { organizationId: string; state: LifecycleState; reason?: string; occurredAt?: Date },
  ) {
    const occurredAt = params.occurredAt ?? new Date();
    const current = await client.restaurantLifecycleEvent.findFirst({
      where: { organizationId: params.organizationId, exitedAt: null },
      orderBy: { enteredAt: 'desc' },
    });

    if (current && current.state === params.state) {
      return current;
    }

    if (current) {
      await client.restaurantLifecycleEvent.update({
        where: { id: current.id },
        data: { exitedAt: occurredAt },
      });
    }

    return client.restaurantLifecycleEvent.create({
      data: {
        organizationId: params.organizationId,
        state: params.state,
        enteredAt: occurredAt,
        reason: params.reason,
      },
    });
  }

  static async currentState(organizationId: string): Promise<LifecycleState | null> {
    const current = await prisma.restaurantLifecycleEvent.findFirst({
      where: { organizationId, exitedAt: null },
      orderBy: { enteredAt: 'desc' },
    });
    return (current?.state as LifecycleState) ?? null;
  }

  static async history(organizationId: string) {
    return prisma.restaurantLifecycleEvent.findMany({
      where: { organizationId },
      orderBy: { enteredAt: 'asc' },
    });
  }

  /**
   * Master spec's sales-funnel view (LEAD→…→ACTIVATION→PAID→RENEWAL→
   * UPGRADE is the sales-side framing of the same states this table
   * tracks from ACTIVATION onward) — counts of restaurants CURRENTLY in
   * each lifecycle state, i.e. a funnel snapshot, not a cohort.
   */
  static async funnelSnapshot() {
    const rows = await prisma.restaurantLifecycleEvent.groupBy({
      by: ['state'],
      where: { exitedAt: null },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.state] = row._count._all;
    return counts;
  }
}
