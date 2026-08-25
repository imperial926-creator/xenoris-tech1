/**
 * Payment provider abstraction — currently UNIMPLEMENTED.
 *
 * `docs/architecture.md` has referenced this interface since Phase 1 as the
 * seam a real PH-market payment gateway (e.g. PayMongo, Maya) will plug
 * into, but the file itself was never actually created until now — closing
 * that documentation gap in Phase 4.
 *
 * No concrete implementation exists yet, and none should be faked. Until a
 * real provider is configured (see `docs/architecture.md` § Required
 * External Integrations), payments in this codebase are recorded manually
 * by staff attesting money changed hands outside the system:
 *   - `ReservationService.recordDeposit` (Phase 3)
 *   - `OrderService.recordPayment` (Phase 4, via the `OrderPayment` table)
 *
 * When a real provider is wired in, it should implement this interface and
 * `OrderService`/`ReservationService` should be updated to call it instead
 * of (or alongside, for reconciliation) manual recording — that is a
 * business/vendor decision flagged in `docs/architecture.md` § Risks, not
 * something to default silently in code.
 */

export interface PaymentIntentResult {
  /** Provider-assigned identifier for this payment attempt. */
  providerReference: string;
  status: 'requires_action' | 'processing' | 'succeeded' | 'failed';
  /** Opaque provider data (e.g. a redirect URL) the UI may need. */
  raw?: unknown;
}

export interface RefundResult {
  providerReference: string;
  status: 'processing' | 'succeeded' | 'failed';
}

export interface PaymentProvider {
  readonly name: string;

  /** Amount is a decimal string (e.g. "218.40"), currency an ISO 4217 code. */
  createPaymentIntent(params: {
    amount: string;
    currency: string;
    referenceId: string; // e.g. an Order id
    description?: string;
  }): Promise<PaymentIntentResult>;

  refund(params: { providerReference: string; amount?: string }): Promise<RefundResult>;

  /** Verifies an inbound webhook's signature before trusting its payload. */
  verifyWebhookSignature(params: { payload: string; signature: string; secret: string }): boolean;
}

/**
 * Throws unconditionally — a stand-in that makes "no provider configured"
 * fail loudly instead of silently pretending to succeed. Nothing in this
 * codebase currently constructs this; it exists so a future call site that
 * forgets to check for a configured provider fails safely.
 */
export class UnconfiguredPaymentProvider implements PaymentProvider {
  readonly name = 'unconfigured';

  async createPaymentIntent(): Promise<PaymentIntentResult> {
    throw new Error(
      'No payment provider is configured. See docs/architecture.md § Required External ' +
        'Integrations. Record payments manually via OrderService.recordPayment until one is.',
    );
  }

  async refund(): Promise<RefundResult> {
    throw new Error('No payment provider is configured.');
  }

  verifyWebhookSignature(): boolean {
    return false;
  }
}
