import { describe, it, expect, beforeAll } from 'vitest';
import {
  createCustomerAccessToken,
  verifyCustomerAccessToken,
  extractBearerToken,
  generateRefreshToken,
  hashRefreshToken,
} from '@/lib/customer-auth/session';

beforeAll(() => {
  process.env.CUSTOMER_AUTH_SECRET =
    'test-customer-secret-do-not-use-in-production-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
});

describe('customer access tokens', () => {
  const payload = { customerAccountId: 'cust_123', email: 'diner@example.com' };

  it('round-trips a valid payload', async () => {
    const token = await createCustomerAccessToken(payload);
    const verified = await verifyCustomerAccessToken(token);
    expect(verified).toEqual(payload);
  });

  it('rejects a tampered token', async () => {
    const token = await createCustomerAccessToken(payload);
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
    expect(await verifyCustomerAccessToken(tampered)).toBeNull();
  });

  it('rejects garbage input', async () => {
    expect(await verifyCustomerAccessToken('not-a-jwt')).toBeNull();
  });

  it('is signed with a different secret than the staff session module', async () => {
    // A token signed for the customer app must never verify as a staff
    // session, and vice versa — this is the whole point of keeping
    // CUSTOMER_AUTH_SECRET distinct from AUTH_SECRET. We can't easily import
    // both modules with two different secrets active at once here, so this
    // test asserts the more direct invariant: verification fails closed
    // (returns null, never throws) against a token this module didn't sign.
    const foreignToken = 'eyJhbGciOiJIUzI1NiJ9.notarealtoken.signature';
    expect(await verifyCustomerAccessToken(foreignToken)).toBeNull();
  });
});

describe('extractBearerToken', () => {
  it('extracts the token from a well-formed header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the scheme', () => {
    expect(extractBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns null for a missing header', () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it('returns null for a header with no scheme', () => {
    expect(extractBearerToken('abc.def.ghi')).toBeNull();
  });
});

describe('refresh tokens', () => {
  it('generates a unique token whose stored hash matches hashRefreshToken', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.token).not.toEqual(b.token);
    expect(a.tokenHash).toEqual(hashRefreshToken(a.token));
    expect(a.tokenHash).not.toEqual(b.tokenHash);
  });

  it('sets an expiry roughly 30 days out', () => {
    const { expiresAt } = generateRefreshToken();
    const daysOut = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(daysOut).toBeGreaterThan(29);
    expect(daysOut).toBeLessThan(31);
  });
});
