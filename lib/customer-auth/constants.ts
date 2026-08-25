/**
 * Customer-auth constants — deliberately separate from lib/auth/constants.ts.
 *
 * The customer mobile app authenticates with bearer tokens (Authorization
 * header), not the staff app's httpOnly session cookie, because a mobile
 * client has no shared browser cookie jar with this server. See
 * docs/customer-app/architecture.md § 4 for the full reasoning, including
 * why access+refresh tokens are signed with CUSTOMER_AUTH_SECRET rather than
 * the staff AUTH_SECRET — a leaked or misconfigured secret on one side must
 * never let a token forge identity on the other.
 */

// Short-lived — the token a mobile client attaches to every request. Kept
// short because it cannot be revoked once issued (stateless JWT); the
// refresh token is the revocable part of the pair.
export const CUSTOMER_ACCESS_TTL_SECONDS = 60 * 15; // 15 minutes

// Long-lived — persisted (as a hash only, see CustomerRefreshToken) so it can
// be revoked individually (logout, this device) or entirely (logout-all).
export const CUSTOMER_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
