/**
 * SMS/mobile-number OTP abstraction for the customer app — currently
 * UNIMPLEMENTED. Same seam pattern as OAuthProvider.ts alongside it; see
 * that file's header for the shared rationale.
 *
 * `CustomerAccount.mobile` already exists so mobile-number identity can be
 * added later without a migration. Until a real SMS provider is configured,
 * registration/login only work by email + password — nothing here should be
 * called, and nothing should pretend an OTP was sent or verified.
 */

export interface OtpProvider {
  readonly name: string;
  /** Sends a one-time code to the given PH mobile number (E.164 format). */
  sendCode(mobile: string): Promise<{ requestId: string }>;
  /** Verifies a previously-sent code against its requestId. */
  verifyCode(requestId: string, code: string): Promise<boolean>;
}

export class UnconfiguredOtpProvider implements OtpProvider {
  readonly name = 'unconfigured';

  async sendCode(): Promise<{ requestId: string }> {
    throw new Error(
      'No SMS/OTP provider is configured. See docs/customer-app/architecture.md § 4 and ' +
        '.env.example. Use email/password registration and login until one is set up.',
    );
  }

  async verifyCode(): Promise<boolean> {
    throw new Error('No SMS/OTP provider is configured.');
  }
}
