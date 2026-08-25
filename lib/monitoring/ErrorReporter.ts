/**
 * Error-tracking provider abstraction (master spec §63 "Observability":
 * "Implement: ... Error tracking ..."). Same provider-agnostic seam shape
 * as `lib/payments/PaymentProvider.ts`, `lib/notifications/*Provider.ts`,
 * `lib/ai/AIProvider.ts`, and `lib/storage/StorageProvider.ts` — the real
 * implementation (e.g. Sentry, Rollbar, Bugsnag) plugs in behind this
 * interface, none is faked, and `ERROR_REPORTING_PROVIDER_KEY` (reserved in
 * `.env.example`) currently always falls back to the unconfigured stub.
 *
 * ONE DELIBERATE DEVIATION from every other `Unconfigured*Provider` in this
 * codebase: those throw unconditionally when called unconfigured, so a
 * missing integration fails loudly. `UnconfiguredErrorReporter` does the
 * opposite — it's a silent no-op. Throwing from inside error-reporting code
 * would risk masking the *original* error being reported (or crashing a
 * catch block that exists specifically to keep the app from crashing), which
 * is worse than just not reporting. `lib/monitoring/logger.ts`'s structured
 * `log.error()` already durably records every error to stdout/stderr
 * regardless of whether a provider is configured — this class is additive
 * (an aggregation/alerting layer on top), never the only record.
 */

export interface ErrorReporter {
  readonly name: string;

  /** Never throws, configured or not — see the class-level note above. */
  captureException(error: unknown, context?: Record<string, unknown>): void;
}

export class UnconfiguredErrorReporter implements ErrorReporter {
  readonly name = 'unconfigured';

  captureException(): void {
    // Deliberate no-op — see this file's header. The error itself was
    // already passed to `log.error()` by every call site before (or
    // instead of) reaching here; nothing is silently lost.
  }
}

/**
 * Resolves the configured error-tracking provider from environment,
 * following the same factory shape as `lib/notifications/EmailProvider.ts`'s
 * `getEmailProvider`. Reads `ERROR_REPORTING_PROVIDER_KEY`. No concrete
 * provider is registered in this codebase yet.
 */
export function getErrorReporter(): ErrorReporter {
  const configured = process.env.ERROR_REPORTING_PROVIDER_KEY;
  if (!configured) return new UnconfiguredErrorReporter();
  // No branch matches yet — every value currently falls back to the
  // unconfigured stub until a real provider is implemented and registered.
  return new UnconfiguredErrorReporter();
}
