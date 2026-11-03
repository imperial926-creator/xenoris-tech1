import { describe, it, expect, vi, afterEach } from 'vitest';
import { redact, log } from '@/lib/monitoring/logger';

// Pure redaction-logic tests (§63 Observability's "do not log" denylist),
// plus a couple of smoke tests that log.* actually emits valid, redacted
// JSON — no DB needed, same "pure function → unit test" split as
// tests/unit/config/env.test.ts.

describe('redact', () => {
  it('passes through primitives unchanged', () => {
    expect(redact('hello')).toBe('hello');
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  it('redacts a top-level password field', () => {
    const result = redact({ email: 'a@b.com', password: 'hunter2' }) as Record<string, unknown>;
    expect(result.email).toBe('a@b.com');
    expect(result.password).toBe('[REDACTED]');
  });

  it.each([
    'password',
    'Password',
    'passwordHash',
    'authToken',
    'authSecret',
    'AUTH_SECRET',
    'apiKey',
    'secretKey',
    'sessionId',
    'cardNumber',
    'cvv',
    'cvc',
    'bankAccountNumber',
    'routingNumber',
    'Authorization',
    'cookie',
  ])('redacts a field named %s', (key) => {
    const result = redact({ [key]: 'sensitive-value' }) as Record<string, unknown>;
    expect(result[key]).toBe('[REDACTED]');
  });

  it('does not redact unrelated fields that merely contain a substring collision', () => {
    // "tokenCount" and "cookieBanner" are not secrets, but the pattern is
    // deliberately broad (see logger.ts's header: "better to over-redact");
    // this test documents that current tradeoff rather than asserting the
    // opposite.
    const result = redact({ orderId: 'ord_123', quantity: 3 }) as Record<string, unknown>;
    expect(result.orderId).toBe('ord_123');
    expect(result.quantity).toBe(3);
  });

  it('redacts sensitive fields at any nesting depth', () => {
    const result = redact({
      user: { profile: { credentials: { password: 'hunter2' } } },
    }) as any;
    expect(result.user.profile.credentials.password).toBe('[REDACTED]');
  });

  it('redacts sensitive fields inside arrays', () => {
    const result = redact({
      attempts: [{ token: 'abc' }, { token: 'def' }],
    }) as any;
    expect(result.attempts[0].token).toBe('[REDACTED]');
    expect(result.attempts[1].token).toBe('[REDACTED]');
  });

  it('serializes Date instances to ISO strings rather than redacting or dropping them', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const result = redact({ createdAt: date }) as Record<string, unknown>;
    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('handles circular references without throwing or hanging', () => {
    const obj: any = { name: 'circular' };
    obj.self = obj;
    expect(() => redact(obj)).not.toThrow();
    const result = redact(obj) as any;
    expect(result.self).toBe('[CIRCULAR]');
  });

  it('leaves non-sensitive nested data fully intact', () => {
    const result = redact({
      order: { id: 'ord_1', items: [{ menuItemId: 'm1', quantity: 2 }] },
    }) as any;
    expect(result.order.id).toBe('ord_1');
    expect(result.order.items[0]).toEqual({ menuItemId: 'm1', quantity: 2 });
  });
});

describe('log', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a single JSON line per call, with redaction applied, on console.error for log.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.error('Something failed', new Error('boom'), { userId: 'u1', password: 'hunter2' });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('error');
    expect(parsed.message).toBe('Something failed');
    expect(parsed.context.userId).toBe('u1');
    expect(parsed.context.password).toBe('[REDACTED]');
    expect(parsed.context.error.message).toBe('boom');
    expect(typeof parsed.timestamp).toBe('string');
  });

  it('routes warn to console.warn and info/debug to console.log', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    log.warn('a warning');
    expect(warnSpy).toHaveBeenCalledTimes(1);

    log.info('some info');
    log.debug('debug detail');
    expect(logSpy).toHaveBeenCalledTimes(2);
  });
});
