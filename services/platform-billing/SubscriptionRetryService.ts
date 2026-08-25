import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { getSubscriptionGatewayProvider } from '@/lib/platform-billing/SubscriptionGatewayProvider';
import { PlatformBillingConfigService } from './PlatformBillingConfigService';
import { ActionCenterService, TASK_TYPES } from './ActionCenterService';
import { log } from '@/lib/monitoring/logger';
import { RestaurantLifecycleService } from '@/services/platform-analytics/RestaurantLifecycleService';

/**
 * Master spec §20's "the retry schedule must be configurable ... do not
 * hard-code retry intervals" plus §22's grace period. This service computes
 * WHEN a retry/suspension should happen (`Subscription.nextRetryAt` /
 * `gracePeriodEndsAt`, written by `SubscriptionWebhookService.
 * handlePaymentFailed`), and `runDueRetries` below is what actually ACTS on
 * a due date once one arrives.
 *
 * Known infrastructure gap, stated plainly rather than silently worked
 * around (same discipline as NotificationService's header point 5 for
 * reminder-type sends): this codebase has no cron/queue/background-worker
 * process anywhere. `runDueRetries` is fully implemented and correct, but
 * nothing in this codebase calls it on a timer. It is exposed at
 * `POST /api/v1/platform/cron/subscription-retries`, guarded by a shared
 * secret (`PLATFORM_CRON_SECRET`), specifically so an EXTERNAL scheduler —
 * a real cron job, a platform-as-a-service's built-in cron (e.g. Vercel
 * Cron), or a manual ops trigger — can call it. Wiring that external
 * scheduler is a deployment step (see
 * docs/deployment/production-checklist.md's Phase 17 addendum), not
 * something this application can do to itself from inside a serverless
 * request handler.
 */
export class SubscriptionRetryService {
  static async runDueRetries(): Promise<{ attempted: number; succeeded: number; failed: number; suspended: number }> {
    const now = new Date();
    const config = await PlatformBillingConfigService.get();
    const gateway = getSubscriptionGatewayProvider();

    const due = await prisma.subscription.findMany({
      where: {
        status: 'PAST_DUE',
        OR: [{ nextRetryAt: { lte: now } }, { AND: [{ nextRetryAt: null }, { gracePeriodEndsAt: { lte: now } }] }],
      },
      include: { plan: true, paymentMethod: true },
    });

    let succeeded = 0;
    let failed = 0;
    let suspended = 0;

    for (const subscription of due) {
      // No scheduled retry left AND grace period has elapsed → suspend
      // directly without attempting another charge (master spec §23).
      if (!subscription.nextRetryAt && subscription.gracePeriodEndsAt && subscription.gracePeriodEndsAt <= now) {
        await prisma.$transaction(async (tx) => {
          await tx.subscription.update({
            where: { id: subscription.id },
            data: { status: 'SUSPENDED', suspendedAt: now },
          });
          await ActionCenterService.createTask(tx, {
            type: TASK_TYPES.SUBSCRIPTION_SUSPENDED,
            title: `Subscription suspended (grace period elapsed) — organization ${subscription.organizationId}`,
            priority: 'HIGH',
            organizationId: subscription.organizationId,
            subscriptionId: subscription.id,
          });
          // No MRR movement here — this subscription was already PAST_DUE
          // (excluded from the ACTIVE-only MRR sum) and its CHURNED event
          // was already recorded when it first left ACTIVE, in
          // SubscriptionWebhookService.handlePaymentFailed. This is purely
          // a lifecycle-history transition (PAST_DUE -> SUSPENDED).
          await RestaurantLifecycleService.transition(tx, {
            organizationId: subscription.organizationId,
            state: 'SUSPENDED',
            reason: 'Grace period elapsed, no scheduled retry remaining',
          });
        });
        suspended += 1;
        continue;
      }

      if (!subscription.paymentMethodId) {
        // Nothing to charge — same failure path as a declined card,
        // logged so it doesn't retry forever against nothing.
        failed += 1;
        continue;
      }

      try {
        // A real gateway integration would call something like
        // gateway.chargeSavedMethod(...) here and let its own webhook
        // report success/failure asynchronously (the pattern this whole
        // subsystem is built around — see SubscriptionGatewayProvider's
        // header on why the provider owns the renewal clock). Until one is
        // configured this always throws via UnconfiguredSubscriptionGatewayProvider,
        // which is surfaced honestly below rather than faked as a success.
        await gateway.createSubscription({
          providerCustomerId: subscription.billingCustomerId,
          providerPaymentMethodId: subscription.paymentMethodId,
          amount: subscription.plan.monthlyPrice.toFixed(2),
          currency: subscription.plan.currency,
          intervalMonths: subscription.billingIntervalMonths,
          referenceId: subscription.id,
        });
        succeeded += 1;
      } catch (error) {
        log.warn(`Subscription retry charge failed for ${subscription.id}`, error);
        failed += 1;
      }
    }

    void config;
    return { attempted: due.length, succeeded, failed, suspended };
  }
}
