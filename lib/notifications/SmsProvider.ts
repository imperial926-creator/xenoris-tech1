/**
 * SMS provider abstraction — currently UNIMPLEMENTED, same "unconfigured
 * stub that fails loudly" pattern as `lib/notifications/EmailProvider.ts`'s
 * `UnconfiguredEmailProvider` (and `lib/payments/PaymentProvider.ts` /
 * `lib/ai/AIProvider.ts` before it).
 *
 * Master spec §57 lists "SMS: Transactional SMS provider" among the
 * external integrations this app must stay provider-agnostic to — this
 * interface is the seam a real SMS gateway (e.g. Twilio, Semaphore, a
 * PH-market SMS aggregator) plugs into. No concrete implementation exists
 * yet, and none should be faked: until one is configured
 * (`SMS_PROVIDER_KEY` per `.env.example`), `NotificationService` records
 * every SMS attempt with `status: SKIPPED_NOT_CONFIGURED` rather than
 * pretending to send — see that file's header for the full "notifications
 * are best-effort, never block the primary flow" design.
 */

export interface SmsSendResult {
  /** Provider-assigned identifier for this send attempt. */
  providerReference: string;
  status: 'sent' | 'failed';
}

export interface SmsProvider {
  readonly name: string;

  /** No `subject` — SMS is body-only, unlike email. */
  send(params: { to: string; body: string }): Promise<SmsSendResult>;
}

/**
 * Throws unconditionally — makes "no provider configured" fail loudly
 * instead of silently pretending to succeed. `NotificationService` checks
 * `provider.name === 'unconfigured'` before ever calling `send`, so this
 * throw only surfaces if something calls a provider directly without that
 * check — the same safety-net role `UnconfiguredEmailProvider` plays.
 */
export class UnconfiguredSmsProvider implements SmsProvider {
  readonly name = 'unconfigured';

  async send(): Promise<SmsSendResult> {
    throw new Error(
      'No SMS provider is configured. See docs/architecture.md § Required External ' +
        'Integrations. NotificationService records this as SKIPPED_NOT_CONFIGURED rather than calling here.',
    );
  }
}

/**
 * Resolves the configured SMS provider from environment, following the
 * same provider-agnostic factory shape as `lib/notifications/EmailProvider.ts`'s
 * `getEmailProvider`. Reads `SMS_PROVIDER_KEY` (reserved in `.env.example`
 * since Phase 1). No concrete provider is registered in this codebase yet
 * — wiring one in later is a matter of adding a branch here, not changing
 * any call site in `NotificationService`.
 */
export function getSmsProvider(): SmsProvider {
  const configured = process.env.SMS_PROVIDER_KEY;
  if (!configured) return new UnconfiguredSmsProvider();
  // No branch matches yet — every value of SMS_PROVIDER_KEY currently
  // falls back to the unconfigured stub until a real provider is
  // implemented and registered here.
  return new UnconfiguredSmsProvider();
}
