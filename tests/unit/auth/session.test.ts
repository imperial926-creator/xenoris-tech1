import { describe, it, expect, beforeAll } from 'vitest';
import { createSessionToken, verifySessionToken } from '@/lib/auth/session';

beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-do-not-use-in-production-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
});

describe('session tokens', () => {
  const payload = {
    userId: 'user_123',
    organizationId: 'org_123',
    email: 'owner@example.com',
    roles: ['OWNER'],
  };

  it('round-trips a valid session payload', async () => {
    const token = await createSessionToken(payload);
    const verified = await verifySessionToken(token);
    expect(verified).toEqual(payload);
  });

  it('rejects a tampered token', async () => {
    const token = await createSessionToken(payload);
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
    const verified = await verifySessionToken(tampered);
    expect(verified).toBeNull();
  });

  it('rejects garbage input', async () => {
    const verified = await verifySessionToken('not-a-jwt');
    expect(verified).toBeNull();
  });
});
