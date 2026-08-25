/**
 * Recurring subscription payment-gateway abstraction — currently
 * UNIMPLEMENTED, same "unconfigured stub that fails loudly" pattern as
 * `lib/payments/PaymentProvider.ts`, `lib/notifications/SmsProvider.ts`,
 * `lib/notifications/EmailProvider.ts`, and `lib/ai/AIProvider.ts` before it.
 *
 * Deliberately a SEPARATE interface from `lib/payments/PaymentProvider.ts`,
 * not a reuse of it — see the Phase 17 header comment in schema.prisma for
 * the full reasoning. Short version: `PaymentProvider` models one-off order
 * payments (create an intent for a specific amount, optionally refund it).
 * Recurring SaaS subscription billing needs three capabilities that shape
 * doesn't have: a persistent provider-side CUSTOMER, a persistent tokenized
 * PAYMENT METHOD attached to that customer, and a provider-side SUBSCRIPTION
 * object the provider itself charges on schedule (master spec §2: "the
 * payment gateway must support ... recurring subscriptions" — the provider
 * owns the renewal clock, not this application; see
 * SubscriptionRetryService's header for what that does and doesn't mean for
 * failed-payment retries).
 *
 * No concrete implementation exists yet, and none should be faked. Until a
 * real provider (e.g. PayMongo, Maya Business, Stripe Billing) is configured
 * via `SUBSCRIPTION_PAYMENT_PROVIDER_KEY` (see .env.example), every method
 * here throws — `SubscriptionService` surfaces that as a clear "payment
 * setup is not yet configured" error rather than silently pretending a
 * checkout succeeded. This is intentional: master spec §55's "Payment
 * Activation Checklist" and §56/§57's TEST-vs-LIVE separation only make
 * sense if "not configured" is a real, distinguishable state.
 */

export interface GatewayCustomer {
  providerCustomerId: string;
}

export interface GatewayPaymentMethod {
  providerPaymentMethodId: string;
  type: string;
  cardBrand?: string;
  lastFour?: string;
  expirationMonth?: number;
  expirationYear?: number;
}

export interface CheckoutSessionResult {
  /** Where to send the restaurant owner to complete secure card entry — a
   * provider-hosted checkout page or the client token for a hosted payment
   * component embedded in our own Subscription Checkout page (master spec
   * §10: "redirect ... OR display the payment provider's secure hosted
   * payment component"). Either way, raw card data never touches this
   * application's servers. */
  checkoutUrl?: string;
  clientSecret?: string;
  providerReference: string;
}

export interface GatewaySubscriptionResult {
  providerSubscriptionId: string;
  status: 'active' | 'incomplete' | 'past_due';
  currentPeriodStart: string;
  currentPeriodEnd: string;
}

export interface GatewayRefundResult {
  providerReference: string;
  status: 'processing' | 'succeeded' | 'failed';
}

export interface SubscriptionGatewayProvider {
  readonly name: string;

  /** Creates (or returns the existing) provider-side customer for a
   * restaurant organization's billing identity. */
  createCustomer(params: { email: string; name: string; referenceId: string }): Promise<GatewayCustomer>;

  /** Starts a secure, hosted checkout flow for a restaurant owner to enter
   * card details and authorize the first payment + saved payment method.
   * Amount is a decimal string (e.g. "999.00"), currency an ISO 4217 code. */
  createCheckoutSession(params: {
    providerCustomerId: string;
    amount: string;
    currency: string;
    planReference: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSessionResult>;

  /** Creates the provider-side recurring subscription that will charge the
   * saved payment method automatically on each billing cycle. */
  createSubscription(params: {
    providerCustomerId: string;
    providerPaymentMethodId: string;
    amount: string;
    currency: string;
    intervalMonths: number;
    referenceId: string;
  }): Promise<GatewaySubscriptionResult>;

  cancelSubscription(params: { providerSubscriptionId: string }): Promise<void>;

  refund(params: { providerPaymentId: string; amount?: string }): Promise<GatewayRefundResult>;

  /** Verifies an inbound webhook's signature before trusting its payload —
   * master spec §37: "never trust an unverified webhook." */
  verifyWebhookSignature(params: { payload: string; signature: string; secret: string }): boolean;
}

/**
 * Throws unconditionally — makes "no subscription payment gateway
 * configured" fail loudly instead of silently pretending to succeed.
 * `SubscriptionService` checks `provider.name === 'unconfigured'` up front
 * on every checkout attempt and returns a clear, actionable error instead of
 * calling into this, the same safety-net role `UnconfiguredPaymentProvider`
 * plays for order payments.
 */
export class UnconfiguredSubscriptionGatewayProvider implements SubscriptionGatewayProvider {
  readonly name = 'unconfigured';

  private fail(): never {
    throw new Error(
      'No subscription payment gateway is configured. Set SUBSCRIPTION_PAYMENT_PROVIDER_KEY and ' +
        'SUBSCRIPTION_PAYMENT_WEBHOOK_SECRET (see .env.example, "Platform Subscription Billing" ' +
        'section) and register a concrete provider in getSubscriptionGatewayProvider() before ' +
        'restaurant owners can subscribe. See docs/deployment/production-checklist.md.',
    );
  }

  async createCustomer(): Promise<GatewayCustomer> {
    this.fail();
  }

  async createCheckoutSession(): Promise<CheckoutSessionResult> {
    this.fail();
  }

  async createSubscription(): Promise<GatewaySubscriptionResult> {
    this.fail();
  }

  async cancelSubscription(): Promise<void> {
    this.fail();
  }

  async refund(): Promise<GatewayRefundResult> {
    this.fail();
  }

  verifyWebhookSignature(): boolean {
    return false;
  }
}

/**
 * Resolves the configured subscription gateway provider from environment,
 * following the same provider-agnostic factory shape as
 * `lib/notifications/SmsProvider.ts`'s `getSmsProvider` and
 * `lib/payments/PaymentProvider.ts`'s sibling factory. Reads
 * `SUBSCRIPTION_PAYMENT_PROVIDER_KEY`. No concrete provider is registered in
 * this codebase yet — wiring one in later (master spec §2: "the application
 * architecture must allow the payment provider to be changed in the future
 * without rewriting the entire subscription system") is a matter of adding
 * a branch here, not changing any call site in SubscriptionService,
 * SubscriptionWebhookService, or SubscriptionRetryService.
 */
export function getSubscriptionGatewayProvider(): SubscriptionGatewayProvider {
  const configured = process.env.SUBSCRIPTION_PAYMENT_PROVIDER_KEY;
  if (!configured) return new UnconfiguredSubscriptionGatewayProvider();
  // No branch matches yet — every value of SUBSCRIPTION_PAYMENT_PROVIDER_KEY
  // currently falls back to the unconfigured stub until a real provider
  // (e.g. 'paymongo', 'maya') is implemented and registered here.
  return new UnconfiguredSubscriptionGatewayProvider();
}
