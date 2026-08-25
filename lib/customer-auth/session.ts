import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'crypto';
import { CUSTOMER_ACCESS_TTL_SECONDS, CUSTOMER_REFRESH_TTL_SECONDS } from './constants';

export interface CustomerAccessPayload {
  customerAccountId: string;
  email: string | null;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.CUSTOMER_AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'CUSTOMER_AUTH_SECRET is not set (or too short). Set a long random value in your ' +
        'environment — see .env.example. This must be a DIFFERENT secret than AUTH_SECRET: ' +
        'the staff and customer token spaces are intentionally not interchangeable.',
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createCustomerAccessToken(payload: CustomerAccessPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${CUSTOMER_ACCESS_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifyCustomerAccessToken(
  token: string,
): Promise<CustomerAccessPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.customerAccountId === 'string') {
      return {
        customerAccountId: payload.customerAccountId,
        email: typeof payload.email === 'string' ? payload.email : null,
      };
    }
    return null;
  } catch {
    // Expired, malformed, or forged — treated identically as "no session".
    return null;
  }
}

/** Reads the bearer token out of a standard `Authorization: Bearer <token>` header. */
export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  // match[1] is captured by a `+` (one-or-more) group, so whenever `match`
  // itself is non-null this element always exists — but `noUncheckedIndexedAccess`
  // still types any array index as possibly-`undefined`, hence the `?? null`.
  return match?.[1] ?? null;
}

/**
 * Refresh tokens are opaque random strings, not JWTs — the DB row (keyed by
 * a SHA-256 hash of the token, never the raw value) is the source of truth
 * for validity, so a refresh token can be revoked (logout / logout-all)
 * immediately rather than waiting out an expiry. Mirrors the same
 * "store a hash, never the secret" discipline as lib/auth/password.ts.
 */
export function generateRefreshToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(48).toString('base64url');
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + CUSTOMER_REFRESH_TTL_SECONDS * 1000);
  return { token, tokenHash, expiresAt };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
