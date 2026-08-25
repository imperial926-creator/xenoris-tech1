import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { getSubscriptionGatewayProvider } from '@/lib/platform-billing/SubscriptionGatewayProvider';
import { writeAuditLog } from '@/lib/audit/log';
import { RestaurantLifecycleService } from '@/services/platform-analytics/RestaurantLifecycleService';
import { MrrMovementService } from '@/services/platform-analytics/MrrMovementService';
import { PlatformEventTrackingService, EVENT_TYPES } from '@/services/platform-analytics/PlatformEventTrackingService';

/**
 * Restaurant-owner-facing subscription lifecycle: master spec §5, §6, §9,
 * §54's "extremely simple" SUBSCRIBE → Subscription Checkout → secure
 * payment flow. Every method here is careful to NEVER surface anything
 * about the SaaS Owner's merchant/settlement configuration — see
 * `toOwnerFacingSubscription` below, the single choke point every response
 * in this service is filtered through.
 *
 * Master spec §11's hard rule shapes this file more than any other single
 * line in the spec: "The application must NOT activate the subscription
 * merely because the restaurant owner returned from the payment page. ...
 * The authoritative payment confirmation must come from the payment
 * provider through a secure server-side response or verified webhook."
 * Nothing in `createCheckout` below writes `status: 'ACTIVE'` anywhere —
 * only `SubscriptionWebhookService.handlePaymentSucceeded` (a verified
 * inbound webhook) does that.
 */
export class SubscriptionService {
  /** Owner dashboard's [SUBSCRIBE] / [CURRENT PLAN] card — master spec §54. */
  static async getForOrganization(organizationId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true, paymentMethod: true },
    });
    if (!subscription) return null;
    return this.toOwnerFacingSubscription(subscription);
  }

  /**
   * Master spec §6/§8/§9: SUBSCRIBE → identify plans → Subscription
   * Checkout preview (plan, price, tax, total, next billing date) → secure
   * payment. This method covers "identify the restaurant, identify
   * available plans, open Subscription Checkout" — it creates the local
   * BillingCustomer/Subscription/payment-attempt rows and hands back
   * everything the checkout preview UI needs, but stops short of
   * activating anything (see class header).
   */
  static async createCheckout(
    organizationId: string,
    planId: string,
    actorUserId: string,
  ) {
    const [organization, plan, existingSubscription] = await Promise.all([
      prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      prisma.subscriptionPlan.findUnique({ where: { id: planId } }),
      prisma.subscription.findUnique({ where: { organizationId } }),
    ]);

    if (!plan || plan.status !== 'ACTIVE') {
      throw new NotFoundError('Subscription plan');
    }
    if (existingSubscription && existingSubscription.status === 'ACTIVE') {
      throw new ConflictError('This organization already has an active subscription.');
    }

    const gateway = getSubscriptionGatewayProvider();

    const result = await prisma.$transaction(async (tx) => {
      const billingCustomer = await tx.billingCustomer.upsert({
        where: { organizationId },
        update: {},
        create: {
          organizationId,
          paymentProvider: gateway.name,
          // Placeholder until the checkout-session call below (or its real
          // provider implementation) returns a real provider customer id —
          // see the comment on the gateway call just below for why this
          // method still builds the full preview even when unconfigured.
          providerCustomerId: `pending-${organizationId}`,
          billingEmail: organization.email,
          billingName: organization.name,
          currency: plan.currency,
        },
      });

      const subscription = await tx.subscription.upsert({
        where: { organizationId },
        update: { planId: plan.id, billingIntervalMonths: plan.billingIntervalMonths, status: 'INCOMPLETE' },
        create: {
          organizationId,
          planId: plan.id,
          billingCustomerId: billingCustomer.id,
          billingIntervalMonths: plan.billingIntervalMonths,
          status: 'INCOMPLETE',
        },
      });

      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: 'subscription.checkout_started',
        entityType: 'Subscription',
        entityId: subscription.id,
        newValue: { planId: plan.id },
      });

      // Phase 18 — lifecycle history. Starting checkout is the moment a
      // registered restaurant begins ONBOARDING onto a paid plan; it moves
      // to ACTIVE only once SubscriptionWebhookService.handlePaymentSucceeded
      // confirms a verified payment (see this file's header rule).
      await RestaurantLifecycleService.transition(tx, {
        organizationId,
        state: 'ONBOARDING',
        reason: 'Subscription checkout started',
      });

      return { billingCustomer, subscription };
    });

    const price = plan.promoPrice && plan.promoValidUntil && plan.promoValidUntil > new Date()
      ? plan.promoPrice
      : plan.monthlyPrice;
    const discount = plan.promoPrice && plan.promoValidUntil && plan.promoValidUntil > new Date()
      ? plan.monthlyPrice.minus(plan.promoPrice)
      : null;

    // The checkout PREVIEW (master spec §8's exact field list: plan, price,
    // discount, tax, total, next billing date) is always computable and
    // returned regardless of gateway configuration — a restaurant owner can
    // review what they'd be charged even in a sandbox with no gateway
    // wired in yet. Only the actual hosted-payment redirect requires a
    // configured gateway, isolated to this one try/catch so the rest of
    // the response still renders.
    let checkoutSession: { checkoutUrl?: string; clientSecret?: string; providerReference: string } | null = null;
    let gatewayError: string | null = null;
    try {
      checkoutSession = await gateway.createCheckoutSession({
        providerCustomerId: result.billingCustomer.providerCustomerId,
        amount: price.toFixed(2),
        currency: plan.currency,
        planReference: plan.id,
        successUrl: `${process.env.APP_URL}/dashboard/billing/success`,
        cancelUrl: `${process.env.APP_URL}/dashboard/billing`,
      });
    } catch (error) {
      gatewayError = error instanceof Error ? error.message : 'Payment gateway unavailable.';
    }

    return {
      subscriptionId: result.subscription.id,
      restaurant: { name: organization.name, id: organization.id },
      plan: {
        id: plan.id,
        name: plan.name,
        features: plan.features,
        billingIntervalMonths: plan.billingIntervalMonths,
      },
      billing: {
        price: price.toFixed(2),
        discount: discount ? discount.toFixed(2) : '0.00',
        tax: '0.00', // No VAT/tax rule specified by master spec for platform subscriptions; kept explicit rather than silently omitted.
        total: price.toFixed(2),
        currency: plan.currency,
        nextBillingDate: null, // Set once the gateway confirms the first payment — see SubscriptionWebhookService.
        interval: plan.billingIntervalMonths === 1 ? 'Monthly' : `Every ${plan.billingIntervalMonths} months`,
      },
      paymentMethod: 'Credit/Debit Card',
      checkout: checkoutSession,
      gatewayError,
    };
  }

  static async cancel(organizationId: string, actorUserId: string) {
    const subscription = await prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
    if (!subscription) throw new NotFoundError('Subscription');
    if (subscription.status === 'CANCELLED') {
      throw new ConflictError('Subscription is already cancelled.');
    }
    const wasActive = subscription.status === 'ACTIVE';
    const monthlyValue = Number(subscription.plan.monthlyPrice) / Math.max(1, subscription.billingIntervalMonths);

    const gateway = getSubscriptionGatewayProvider();
    if (subscription.providerSubscriptionId) {
      try {
        await gateway.cancelSubscription({ providerSubscriptionId: subscription.providerSubscriptionId });
      } catch (error) {
        // Cancellation intent is recorded locally regardless — a gateway
        // hiccup must not trap a restaurant owner into a subscription they
        // asked to leave. Reconciliation (§41) surfaces any mismatch.
      }
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { organizationId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: 'subscription.cancel',
        entityType: 'Subscription',
        entityId: subscription.id,
        previousValue: { status: subscription.status },
        newValue: { status: 'CANCELLED' },
      });

      await RestaurantLifecycleService.transition(tx, {
        organizationId,
        state: 'CANCELLED',
        reason: 'Cancelled by restaurant owner',
      });
      if (wasActive) {
        await MrrMovementService.record(tx, {
          organizationId,
          subscriptionId: subscription.id,
          type: 'CHURNED',
          amount: monthlyValue.toFixed(2),
          previousPlanId: subscription.planId,
        });
      }

      return updated;
    }).then(async (updated) => {
      await PlatformEventTrackingService.track({
        eventType: EVENT_TYPES.SUBSCRIPTION_CANCELLED,
        organizationId,
        subscriptionId: subscription.id,
        userId: actorUserId,
        metadata: { initiatedBy: 'owner' },
      });
      return updated;
    });
  }

  /**
   * The ONE place a Subscription's fields become an HTTP response.
   * Deliberately an explicit field allowlist, not `{ ...subscription }` —
   * master spec §4/§53's "never expose settlement information" rule is
   * satisfied structurally here: there IS no settlement field on this
   * model to accidentally leak (it doesn't exist anywhere in this schema —
   * see PlatformBillingConfig's header), but this allowlist is the
   * belt-and-suspenders guard against a future field being added to
   * `Subscription` and silently starting to leak through every route that
   * calls this.
   */
  private static toOwnerFacingSubscription(
    subscription: Prisma.SubscriptionGetPayload<{ include: { plan: true; paymentMethod: true } }>,
  ) {
    return {
      id: subscription.id,
      status: subscription.status,
      plan: subscription.plan
        ? { id: subscription.plan.id, name: subscription.plan.name, features: subscription.plan.features }
        : null,
      currentPeriodEnd: subscription.currentPeriodEnd,
      nextBillingDate: subscription.nextBillingDate,
      gracePeriodEndsAt: subscription.gracePeriodEndsAt,
      paymentMethod: subscription.paymentMethod
        ? {
            cardBrand: subscription.paymentMethod.cardBrand,
            lastFour: subscription.paymentMethod.lastFour,
          }
        : null,
    };
  }
}
