/**
 * Push notification provider abstraction — currently UNIMPLEMENTED, same
 * "unconfigured stub that fails loudly" pattern as this directory's
 * `EmailProvider.ts` / `SmsProvider.ts`.
 *
 * Master spec §40 lists "Push" among the notification channels, and §57
 * lists a push provider among the external integrations this app must stay
 * provider-agnostic to. Unlike Email/SMS, this build has NO device-token or
 * push-subscription registration flow anywhere in the codebase (no mobile
 * app, no service-worker subscription capture on the web dashboard) — so
 * there is no recipient to push to even in principle yet. `NotificationService`
 * therefore never calls `send` on this provider at all in this build; the
 * interface and stub exist purely so the integration seam is correctly
 * shaped for a future phase that adds device registration, matching the
 * "build the correct interface, flag what's not configured" discipline
 * used for `PaymentProvider`/`AIProvider`/`EmailProvider`/`SmsProvider`.
 */

export interface PushSendResult {
  /** Provider-assigned identifier for this send attempt. */
  providerReference: string;
  status: 'sent' | 'failed';
}

export interface PushProvider {
  readonly name: string;

  /** `to` is a device/push token — no registration flow produces one yet. */
  send(params: { to: string; title: string; body: string }): Promise<PushSendResult>;
}

/**
 * Throws unconditionally. Never called by `NotificationService` in this
 * build (see file header) — kept for interface completeness and as a
 * safety net matching every other `Unconfigured*Provider` in this codebase.
 */
export class UnconfiguredPushProvider implements PushProvider {
  readonly name = 'unconfigured';

  async send(): Promise<PushSendResult> {
    throw new Error(
      'No push provider is configured, and no device-registration flow exists yet. ' +
        'See docs/architecture.md § Required External Integrations.',
    );
  }
}

/**
 * Resolves the configured push provider from environment, following the
 * same provider-agnostic factory shape as `getEmailProvider`/`getSmsProvider`.
 * Reads `PUSH_NOTIFICATION_KEY` (reserved in `.env.example` since Phase 1).
 * No concrete provider is registered in this codebase yet, and — per the
 * file header — nothing calls this factory from `NotificationService` today.
 */
export function getPushProvider(): PushProvider {
  const configured = process.env.PUSH_NOTIFICATION_KEY;
  if (!configured) return new UnconfiguredPushProvider();
  return new UnconfiguredPushProvider();
}
