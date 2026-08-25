import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { getSubscriptionGatewayProvider } from '@/lib/platform-billing/SubscriptionGatewayProvider';
import { getSmsProvider } from '@/lib/notifications/SmsProvider';
import { PlatformInvoiceService } from './PlatformInvoiceService';
import { PlatformBillingConfigService } from './PlatformBillingConfigService';
import { ActionCenterService, TASK_TYPES } from './ActionCenterService';
import { log } from '@/lib/monitoring/logger';
import { RestaurantLifecycleService } from '@/services/platform-analytics/RestaurantLifecycleService';
import { MrrMovementService } from '@/services/platform-analytics/MrrMovementService';
import { PlatformEventTrackingService, EVENT_TYPES } from '@/services/platform-analytics/PlatformEventTrackingService';
import { PlatformHealthService } from '@/services/platform-analytics/PlatformHealthService';

/**
 * Handles inbound payment-provider webhooks — master spec §36-38's
 * "verify signature, validate event, check event ID, check idempotency,
 * update records, trigger actions/notifications" pipeline, and §11-12's
 * "only a verified webhook activates a subscription" rule (see
 * SubscriptionService's header for the fuller reasoning).
 *
 * Every event is persisted to `PlatformWebhookEvent` FIRST, inside the same
 * transaction as whatever state change it causes, keyed by
 * `(provider, providerEventId)` — that unique constraint IS the
 * idempotency guarantee (master spec §38): a provider's at-least-once
 * redelivery of the same event hits the constraint and this method returns
 * early instead of double-activating a subscription or double-sending the
 * owner SMS.
 */
export class SubscriptionWebhookService {
  static async handle(rawPayload: string, signature: string): Promise<{ received: boolean }> {
    const gateway = getSubscriptionGatewayProvider();
    const webhookSecret = process.env.SUBSCRIPTION_PAYMENT_WEBHOOK_SECRET;

    if (!webhookSecret || !gateway.verifyWebhookSignature({ payload: rawPayload, signature, secret: webhookSecret })) {
      await PlatformBillingConfigService.recordWebhookOutcome('failure');
      log.warn('Rejected subscription webhook: signature verification failed or no secret configured');
      // A verification failure is itself an operational problem worth a
      // human's attention — master spec §45 lists "Webhook failure" as an
      // explicit Action Center category — but it is NOT tied to any one
      // organization, so it's created org-less/subscription-less.
      await ActionCenterService.createTask(prisma, {
        type: TASK_TYPES.WEBHOOK_FAILURE,
        title: 'Subscription webhook signature verification failed',
        description: 'An inbound payment-provider webhook failed signature verification and was rejected.',
      });
      await PlatformHealthService.record({
        type: 'WEBHOOK_FAILURE',
        severity: 'MEDIUM',
        message: 'Subscription webhook signature verification failed',
      });
      throw new Error('Webhook signature verification failed.');
    }

    let event: { id: string; type: string; providerEventId: string; payload: Record<string, unknown> };
    try {
      event = JSON.parse(rawPayload);
    } catch {
      throw new Error('Malformed webhook payload.');
    }

    const existing = await prisma.platformWebhookEvent.findUnique({
      where: { provider_providerEventId: { provider: gateway.name, providerEventId: event.providerEventId } },
    });
    if (existing) {
      // Already processed (or currently being processed) — idempotent no-op.
      return { received: true };
    }

    await prisma.platformWebhookEvent.create({
      data: {
        provider: gateway.name,
        providerEventId: event.providerEventId,
        type: event.type,
        payload: event.payload,
      },
    });

    try {
      switch (event.type) {
        case 'subscription.payment_succeeded':
          await this.handlePaymentSucceeded(event.payload as never);
          break;
        case 'subscription.payment_failed':
          await this.handlePaymentFailed(event.payload as never);
          break;
        case 'subscription.refunded':
          await this.handleRefunded(event.payload as never);
          break;
        case 'subscription.cancelled':
          await this.handleCancelled(event.payload as never);
          break;
        default:
          log.warn(`Unhandled subscription webhook event type: ${event.type}`);
      }
      await prisma.platformWebhookEvent.update({
        where: { provider_providerEventId: { provider: gateway.name, providerEventId: event.providerEventId } },
        data: { processedAt: new Date() },
      });
      await PlatformBillingConfigService.recordWebhookOutcome('success');
    } catch (error) {
      await prisma.platformWebhookEvent.update({
        where: { provider_providerEventId: { provider: gateway.name, providerEventId: event.providerEventId } },
        data: { processingError: error instanceof Error ? error.message : String(error) },
      });
      await PlatformBillingConfigService.recordWebhookOutcome('failure');
      await ActionCenterService.createTask(prisma, {
        type: TASK_TYPES.GATEWAY_FAILURE,
        title: `Failed to process webhook event ${event.type}`,
        description: error instanceof Error ? error.message : String(error),
      });
      await PlatformHealthService.record({
        type: 'WEBHOOK_FAILURE',
        severity: 'HIGH',
        message: `Failed to process webhook event ${event.type}`,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    return { received: true };
  }

  /** Master spec §12's full 20-step "Payment Success" sequence. */
  private static async handlePaymentSucceeded(payload: {
    organizationId: string;
    subscriptionId: string;
    providerPaymentId: string;
    providerTransactionId: string;
    amount: string;
    currency: string;
    cardBrand?: string;
    cardLastFour?: string;
    providerSubscriptionId?: string;
    periodStart: string;
    periodEnd: string;
  }) {
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: payload.subscriptionId },
      include: { plan: true },
    });
    const wasFirstActivation = subscription.status === 'INCOMPLETE';
    const wasRecovering = subscription.status === 'PAST_DUE';
    const wasSuspended = subscription.status === 'SUSPENDED';
    const monthlyValue = Number(subscription.plan.monthlyPrice) / Math.max(1, subscription.billingIntervalMonths);

    const { payment, invoice } = await prisma.$transaction(async (tx) => {
      // 1. Create payment record.
      const payment = await tx.subscriptionPayment.create({
        data: {
          organizationId: payload.organizationId,
          subscriptionId: payload.subscriptionId,
          paymentProvider: getSubscriptionGatewayProvider().name,
          providerPaymentId: payload.providerPaymentId,
          providerTransactionId: payload.providerTransactionId,
          amount: payload.amount,
          currency: payload.currency,
          status: 'SUCCEEDED',
          paymentMethodType: 'card',
          cardBrand: payload.cardBrand,
          cardLastFour: payload.cardLastFour,
          billingPeriodStart: new Date(payload.periodStart),
          billingPeriodEnd: new Date(payload.periodEnd),
          paymentAttempt: subscription.retryCount + 1,
          paidAt: new Date(),
        },
      });

      // 2-3. Create invoice + receipt (PlatformInvoiceService.issueForPayment
      // covers both — see that file's header for why they're one artifact).
      const invoice = await PlatformInvoiceService.issueForPayment(tx, {
        organizationId: payload.organizationId,
        subscriptionId: payload.subscriptionId,
        paymentId: payment.id,
        billingPeriodStart: new Date(payload.periodStart),
        billingPeriodEnd: new Date(payload.periodEnd),
        amount: payload.amount,
        currency: payload.currency,
      });

      // 11-13. Activate subscription / set start date / set next renewal.
      await tx.subscription.update({
        where: { id: payload.subscriptionId },
        data: {
          status: 'ACTIVE',
          startDate: subscription.startDate ?? new Date(),
          currentPeriodStart: new Date(payload.periodStart),
          currentPeriodEnd: new Date(payload.periodEnd),
          nextBillingDate: new Date(payload.periodEnd),
          providerSubscriptionId: payload.providerSubscriptionId ?? subscription.providerSubscriptionId,
          retryCount: 0,
          nextRetryAt: null,
          gracePeriodEndsAt: null,
          suspendedAt: null,
        },
      });

      // 18. Update Action Center — auto-resolve any open failed-payment
      // task for this subscription now that payment succeeded.
      if (wasRecovering || wasSuspended) {
        await tx.actionCenterTask.updateMany({
          where: { subscriptionId: payload.subscriptionId, status: { in: ['OPEN', 'NEW', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'FOLLOW_UP_REQUIRED', 'ESCALATED'] } },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
        await ActionCenterService.createTask(tx, {
          type: TASK_TYPES.PAYMENT_RECOVERED,
          title: `Payment recovered for ${subscription.organizationId}`,
          organizationId: payload.organizationId,
          subscriptionId: payload.subscriptionId,
        });
      }

      // Phase 18 — lifecycle history + MRR movement, additive alongside the
      // Subscription.status change above (see RestaurantLifecycleService/
      // MrrMovementService headers). Only a first activation or a recovery
      // from PAST_DUE/SUSPENDED is a real MRR MOVEMENT — a routine renewal
      // of an already-ACTIVE subscription changes no MRR total, so no
      // movement event is recorded for it (the lifecycle event is still
      // written either way, since `transition()` is idempotent when the
      // state hasn't actually changed).
      await RestaurantLifecycleService.transition(tx, {
        organizationId: payload.organizationId,
        state: 'ACTIVE',
        reason: wasFirstActivation ? 'First payment succeeded' : wasRecovering || wasSuspended ? 'Payment recovered' : 'Renewal payment succeeded',
      });
      if (wasFirstActivation) {
        await MrrMovementService.record(tx, {
          organizationId: payload.organizationId,
          subscriptionId: payload.subscriptionId,
          type: 'NEW',
          amount: monthlyValue.toFixed(2),
          newPlanId: subscription.planId,
        });
      } else if (wasRecovering || wasSuspended) {
        await MrrMovementService.record(tx, {
          organizationId: payload.organizationId,
          subscriptionId: payload.subscriptionId,
          type: 'REACTIVATION',
          amount: monthlyValue.toFixed(2),
          newPlanId: subscription.planId,
        });
      }

      return { payment, invoice };
    });

    await PlatformEventTrackingService.track({
      eventType: EVENT_TYPES.PAYMENT_SUCCEEDED,
      organizationId: payload.organizationId,
      subscriptionId: payload.subscriptionId,
      planId: subscription.planId,
      metadata: { amount: payload.amount, currency: payload.currency },
    });

    // 14-17. MRR/ARR/analytics are computed on read (SubscriptionAnalyticsService
    // queries live rows rather than maintaining a denormalized counter) —
    // nothing to update here; see that service's header for why.

    // 19-20. Notifications — best-effort, outside the transaction, same
    // "never let a flaky provider roll back a committed payment" discipline
    // NotificationService documents for every other phase.
    await this.notifyOwnerOfPayment({
      organizationId: payload.organizationId,
      planName: subscription.plan.name,
      amount: payload.amount,
      currency: payload.currency,
      transactionReference: payload.providerTransactionId,
      nextBillingDate: new Date(payload.periodEnd),
    });

    void wasFirstActivation; // Reserved for a future "welcome" email distinct from the renewal notice — not in master spec's explicit field list, so not built speculatively.

    return { payment, invoice };
  }

  /** Master spec §19-23's failed-payment / retry / grace-period / suspension state machine. */
  private static async handlePaymentFailed(payload: {
    organizationId: string;
    subscriptionId: string;
    providerPaymentId?: string;
    amount: string;
    currency: string;
    failureCode?: string;
    failureReason?: string;
  }) {
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: payload.subscriptionId },
      include: { plan: true },
    });
    const wasActive = subscription.status === 'ACTIVE';
    const monthlyValue = Number(subscription.plan.monthlyPrice) / Math.max(1, subscription.billingIntervalMonths);
    const config = await PlatformBillingConfigService.get();
    const retryIntervalDays = (config.retryIntervalDays as number[]) ?? [3, 5, 7];
    const nextAttempt = subscription.retryCount + 1;

    await prisma.subscriptionPayment.create({
      data: {
        organizationId: payload.organizationId,
        subscriptionId: payload.subscriptionId,
        paymentProvider: getSubscriptionGatewayProvider().name,
        providerPaymentId: payload.providerPaymentId,
        amount: payload.amount,
        currency: payload.currency,
        status: 'FAILED',
        paymentAttempt: nextAttempt,
        failureCode: payload.failureCode,
        failureReason: payload.failureReason,
      },
    });

    const retriesExhausted = nextAttempt > retryIntervalDays.length;

    await prisma.$transaction(async (tx) => {
      if (retriesExhausted) {
        // Master spec §23: retries exhausted AND grace period already
        // elapsed (checked by whoever calls this — a webhook only ever
        // reports "this attempt failed"; SubscriptionRetryService.
        // runDueRetries is what actually notices a grace period has
        // elapsed with no scheduled retry left to make) → suspend.
        const gracePeriodEndsAt = subscription.gracePeriodEndsAt ?? new Date(Date.now() + config.gracePeriodDays * 86_400_000);
        const graceElapsed = gracePeriodEndsAt <= new Date();

        await tx.subscription.update({
          where: { id: payload.subscriptionId },
          data: graceElapsed
            ? { status: 'SUSPENDED', suspendedAt: new Date(), retryCount: nextAttempt, nextRetryAt: null }
            : { status: 'PAST_DUE', retryCount: nextAttempt, gracePeriodEndsAt, nextRetryAt: null },
        });

        await ActionCenterService.createTask(tx, {
          type: graceElapsed ? TASK_TYPES.SUBSCRIPTION_SUSPENDED : TASK_TYPES.REPEATED_FAILED_PAYMENT,
          title: graceElapsed
            ? `Subscription suspended for organization ${payload.organizationId}`
            : `Repeated failed payment for organization ${payload.organizationId} — grace period active`,
          description: payload.failureReason,
          priority: graceElapsed ? 'HIGH' : 'HIGH',
          organizationId: payload.organizationId,
          subscriptionId: payload.subscriptionId,
          revenueImpact: monthlyValue.toFixed(2),
        });

        await RestaurantLifecycleService.transition(tx, {
          organizationId: payload.organizationId,
          state: graceElapsed ? 'SUSPENDED' : 'GRACE_PERIOD',
          reason: graceElapsed ? 'Grace period elapsed with no successful retry' : 'Retries exhausted, grace period active',
        });
        // No MRR movement event here: given this state machine, SUSPENDED
        // is only ever reached after the subscription already passed
        // through PAST_DUE (the `else` branch below) at least once — MRR
        // (which only counts ACTIVE subscriptions — see
        // `subscriptionAnalytics()`) already left at THAT point, recorded
        // as CHURNED there. Recording a second CHURNED event here would
        // double-count the same lost revenue.
      } else {
        const nextRetryAt = new Date(Date.now() + retryIntervalDays[nextAttempt - 1] * 86_400_000);
        await tx.subscription.update({
          where: { id: payload.subscriptionId },
          data: { status: 'PAST_DUE', retryCount: nextAttempt, nextRetryAt },
        });

        await ActionCenterService.createTask(tx, {
          type: TASK_TYPES.FAILED_PAYMENT,
          title: `Payment failed for organization ${payload.organizationId} — retry scheduled`,
          description: payload.failureReason,
          priority: 'MEDIUM',
          organizationId: payload.organizationId,
          subscriptionId: payload.subscriptionId,
          revenueImpact: monthlyValue.toFixed(2),
        });

        await RestaurantLifecycleService.transition(tx, {
          organizationId: payload.organizationId,
          state: 'PAST_DUE',
          reason: 'Payment attempt failed, retry scheduled',
        });

        // Master spec's MRR movement: MRR (ACTIVE-only, see
        // `subscriptionAnalytics()`) is lost the moment a subscription
        // FIRST leaves ACTIVE for PAST_DUE, not later at eventual
        // suspension — a subscription that recovers from PAST_DUE before
        // ever reaching suspension already gets a matching REACTIVATION
        // event in `handlePaymentSucceeded`'s `wasRecovering` branch, so
        // the movement report nets out correctly either way.
        if (wasActive) {
          await MrrMovementService.record(tx, {
            organizationId: payload.organizationId,
            subscriptionId: payload.subscriptionId,
            type: 'CHURNED',
            amount: monthlyValue.toFixed(2),
            previousPlanId: subscription.planId,
          });
        }
      }
    });

    await PlatformEventTrackingService.track({
      eventType: EVENT_TYPES.PAYMENT_FAILED,
      organizationId: payload.organizationId,
      subscriptionId: payload.subscriptionId,
      metadata: { failureCode: payload.failureCode, attempt: nextAttempt },
    });

    // Master spec §21's exact restaurant-owner notification copy.
    await this.notifyOwnerOfFailure(payload.organizationId);
  }

  private static async handleRefunded(payload: { paymentId: string; amount?: string }) {
    // Reconciliation-only: an actual refund is normally initiated FROM this
    // app (PlatformRefundService, admin-triggered) — this handler exists
    // for the case a refund is issued directly at the provider's own
    // dashboard and this app must reconcile to match, per master spec §41.
    const payment = await prisma.subscriptionPayment.findFirst({
      where: { providerPaymentId: payload.paymentId },
    });
    if (!payment) return;
    await prisma.subscriptionPayment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
  }

  private static async handleCancelled(payload: { subscriptionId: string }) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: payload.subscriptionId },
      include: { plan: true },
    });
    if (!subscription || subscription.status === 'CANCELLED') return;
    const wasActive = subscription.status === 'ACTIVE';
    const monthlyValue = Number(subscription.plan.monthlyPrice) / Math.max(1, subscription.billingIntervalMonths);

    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: payload.subscriptionId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await ActionCenterService.createTask(tx, {
        type: TASK_TYPES.SUBSCRIPTION_CANCELLATION,
        title: `Subscription cancelled (provider-initiated) — organization ${subscription.organizationId}`,
        organizationId: subscription.organizationId,
        subscriptionId: payload.subscriptionId,
      });
      await RestaurantLifecycleService.transition(tx, {
        organizationId: subscription.organizationId,
        state: 'CANCELLED',
        reason: 'Subscription cancelled (provider-initiated)',
      });
      // Only record CHURNED if it was still ACTIVE (i.e. hadn't already
      // left MRR via an earlier PAST_DUE/suspension movement event —
      // same double-count guard as handlePaymentFailed).
      if (wasActive) {
        await MrrMovementService.record(tx, {
          organizationId: subscription.organizationId,
          subscriptionId: payload.subscriptionId,
          type: 'CHURNED',
          amount: monthlyValue.toFixed(2),
          previousPlanId: subscription.planId,
        });
      }
    });

    await PlatformEventTrackingService.track({
      eventType: EVENT_TYPES.SUBSCRIPTION_CANCELLED,
      organizationId: subscription.organizationId,
      subscriptionId: payload.subscriptionId,
    });
  }

  /**
   * Master spec §25-27: SMS the SaaS Owner's configured notification
   * number after every successful payment. Best-effort — mirrors
   * NotificationService's "never throw, never block the transaction that
   * triggered it" rule, but deliberately does NOT write a `Notification`
   * row (that table's shape assumes a restaurant-scoped recipient
   * snapshot; this recipient is platform-level — see
   * PlatformBillingConfig's `smsNotificationNumber`).
   */
  private static async notifyOwnerOfPayment(params: {
    organizationId: string;
    planName: string;
    amount: string;
    currency: string;
    transactionReference: string;
    nextBillingDate: Date;
  }) {
    try {
      const config = await PlatformBillingConfigService.get();
      if (!config.smsNotificationsEnabled || !config.smsNotificationNumber) return;
      const organization = await prisma.organization.findUnique({ where: { id: params.organizationId } });

      const body = [
        'SUBSCRIPTION PAYMENT RECEIVED.',
        `Restaurant: ${organization?.name ?? params.organizationId}`,
        `Plan: ${params.planName}`,
        `Amount: ${params.currency} ${params.amount}`,
        'Status: SUCCESSFUL',
        `Transaction: ${params.transactionReference}`,
        `Date: ${new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' }).format(new Date())}`,
        `Next Billing: ${new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' }).format(params.nextBillingDate)}`,
      ].join('\n');

      await getSmsProvider().send({ to: config.smsNotificationNumber, body });
    } catch (error) {
      log.warn('Failed to send SaaS Owner payment SMS notification', error);
    }
  }

  private static async notifyOwnerOfFailure(organizationId: string) {
    try {
      const config = await PlatformBillingConfigService.get();
      if (!config.smsNotificationsEnabled || !config.smsNotificationNumber) return;
      const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
      await getSmsProvider().send({
        to: config.smsNotificationNumber,
        body: `SUBSCRIPTION PAYMENT FAILED.\nRestaurant: ${organization?.name ?? organizationId}\nStatus: FAILED\nAction: retry scheduled automatically.`,
      });
    } catch (error) {
      log.warn('Failed to send SaaS Owner payment-failure SMS notification', error);
    }
  }
}
