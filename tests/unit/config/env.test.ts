import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateEnv } from '@/lib/config/env';

// Pure validation logic against process.env — no DB needed, following this
// project's established "pure function → unit test, DB-touching → integration
// test" split (see tests/README.md / tests/unit vs tests/integration).

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const VALID = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/restaurant_platform',
  AUTH_SECRET: 'a-sufficiently-long-random-secret-value',
  APP_URL: 'https://app.example.com',
};

describe('validateEnv', () => {
  beforeEach(() => {
    setEnv({ DATABASE_URL: undefined, AUTH_SECRET: undefined, APP_URL: undefined });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('passes with a fully valid environment', () => {
    setEnv(VALID);
    expect(() => validateEnv()).not.toThrow();
    const result = validateEnv();
    expect(result).toEqual(VALID);
  });

  it('accepts a postgres:// scheme as well as postgresql://', () => {
    setEnv({ ...VALID, DATABASE_URL: 'postgres://user:pass@localhost:5432/db' });
    expect(() => validateEnv()).not.toThrow();
  });

  it('throws when DATABASE_URL is missing', () => {
    setEnv({ ...VALID, DATABASE_URL: undefined });
    expect(() => validateEnv()).toThrow(/DATABASE_URL/);
  });

  it('throws when DATABASE_URL is not a postgres connection string', () => {
    setEnv({ ...VALID, DATABASE_URL: 'mysql://user:pass@localhost:3306/db' });
    expect(() => validateEnv()).toThrow(/DATABASE_URL/);
  });

  it('throws when AUTH_SECRET is missing', () => {
    setEnv({ ...VALID, AUTH_SECRET: undefined });
    expect(() => validateEnv()).toThrow(/AUTH_SECRET/);
  });

  it('throws when AUTH_SECRET is too short', () => {
    setEnv({ ...VALID, AUTH_SECRET: 'too-short' });
    expect(() => validateEnv()).toThrow(/AUTH_SECRET/);
  });

  it('throws when APP_URL is missing', () => {
    setEnv({ ...VALID, APP_URL: undefined });
    expect(() => validateEnv()).toThrow(/APP_URL/);
  });

  it('throws when APP_URL is not a valid URL', () => {
    setEnv({ ...VALID, APP_URL: 'not-a-url' });
    expect(() => validateEnv()).toThrow(/APP_URL/);
  });

  it('throws when APP_URL has a trailing slash', () => {
    setEnv({ ...VALID, APP_URL: 'https://app.example.com/' });
    expect(() => validateEnv()).toThrow(/APP_URL/);
  });

  it('reports every problem at once, not just the first', () => {
    setEnv({ DATABASE_URL: undefined, AUTH_SECRET: 'short', APP_URL: undefined });
    try {
      validateEnv();
      expect.unreachable('validateEnv should have thrown');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/DATABASE_URL/);
      expect(message).toMatch(/AUTH_SECRET/);
      expect(message).toMatch(/APP_URL/);
    }
  });
});
