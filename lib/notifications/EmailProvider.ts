/**
 * Email provider abstraction — currently UNIMPLEMENTED, same "unconfigured
 * stub that fails loudly" pattern as `lib/payments/PaymentProvider.ts`'s
 * `UnconfiguredPaymentProvider` (and, more recently, `lib/ai/AIProvider.ts`'s
 * `UnconfiguredAIProvider`).
 *
 * Master spec §57 lists "Email: Transactional email provider" among the
 * external integrations this app must stay provider-agnostic to — this
 * interface is the seam a real transactional email service (e.g. SendGrid,
 * Postmark, AWS SES) plugs into. No concrete implementation exists yet, and
 * none should be faked: until one is configured (`EMAIL_PROVIDER_KEY` per
 * `.env.example`), `NotificationService` records every email attempt with
 * `status: SKIPPED_NOT_CONFIGURED` rather than pretending to send — see
 * that file's header for the full "notifications are best-effort, never
 * block the primary flow" design.
 */

export interface EmailSendResult {
  /** Provider-assigned identifier for this send attempt. */
  providerReference: string;
  status: 'sent' | 'failed';
}

export interface EmailProvider {
  readonly name: string;

  send(params: { to: string; subject: string; body: string }): Promise<EmailSendResult>;
}

/**
 * Throws unconditionally — makes "no provider configured" fail loudly
 * instead of silently pretending to succeed. `NotificationService` checks
 * `provider.name === 'unconfigured'` before ever calling `send`, so this
 * throw only surfaces if something calls a provider directly without that
 * check — the same safety-net role `UnconfiguredPaymentProvider` plays.
 */
export class UnconfiguredEmailProvider implements EmailProvider {
  readonly name = 'unconfigured';

  async send(): Promise<EmailSendResult> {
    throw new Error(
      'No email provider is configured. See docs/architecture.md § Required External ' +
        'Integrations. NotificationService records this as SKIPPED_NOT_CONFIGURED rather than calling here.',
    );
  }
}

/**
 * Resolves the configured email provider from environment, following the
 * same provider-agnostic factory shape as `lib/ai/AIProvider.ts`'s
 * `getAIProvider`. Reads `EMAIL_PROVIDER_KEY` (reserved in `.env.example`
 * since Phase 1). No concrete provider is registered in this codebase yet
 * — wiring one in later is a matter of adding a branch here, not changing
 * any call site in `NotificationService`.
 */
export function getEmailProvider(): EmailProvider {
  const configured = process.env.EMAIL_PROVIDER_KEY;
  if (!configured) return new UnconfiguredEmailProvider();
  // No branch matches yet — every value of EMAIL_PROVIDER_KEY currently
  // falls back to the unconfigured stub until a real provider is
  // implemented and registered here.
  return new UnconfiguredEmailProvider();
}
