/**
 * Google / Apple sign-in abstraction for the customer app — currently
 * UNIMPLEMENTED, following the same "Unconfigured*Provider" seam pattern as
 * lib/payments/PaymentProvider.ts and lib/storage/StorageProvider.ts.
 *
 * `CustomerAccount.googleId` / `CustomerAccount.appleId` already exist in the
 * schema (see prisma/schema.prisma and docs/customer-app/architecture.md § 3)
 * so this can be wired in later without a migration. Until a real provider
 * is configured, email/password is the only working registration/login path
 * — CustomerAccountService never calls this, and no route claims OAuth
 * works. Do not fake a successful verification here.
 */

export interface OAuthProfile {
  providerId: string;
  email: string | null;
  firstName: string;
  lastName: string | null;
}

export interface OAuthProvider {
  readonly name: 'google' | 'apple';
  /** Verifies a provider-issued identity token and returns the profile it attests to. */
  verifyIdentityToken(idToken: string): Promise<OAuthProfile>;
}

export class UnconfiguredOAuthProvider implements OAuthProvider {
  constructor(readonly name: 'google' | 'apple') {}

  async verifyIdentityToken(): Promise<OAuthProfile> {
    throw new Error(
      `${this.name === 'google' ? 'Google' : 'Apple'} sign-in is not configured. See ` +
        'docs/customer-app/architecture.md § 4 and .env.example. Use email/password ' +
        'registration and login until a provider is set up.',
    );
  }
}
