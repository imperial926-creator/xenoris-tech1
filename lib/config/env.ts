/**
 * Eager, fail-fast environment validation (master spec §60 "Production
 * Deployment": `Environment variables` is its own explicit step in the
 * deploy sequence, between `Database migrations` and `Application
 * deployment` — a misconfigured deploy should fail there, not three
 * requests into production traffic).
 *
 * This complements, not replaces, `lib/auth/session.ts`'s existing
 * `getSecretKey()` check: that check is *lazy* (it only throws the first
 * time a session is signed or verified, which could be minutes into a
 * cold-started server handling its first login), and it only covers
 * `AUTH_SECRET`. This module is *eager* — call `validateEnv()` once at
 * process startup (wired via `instrumentation.ts`'s Next.js `register()`
 * hook) so a missing `DATABASE_URL` or too-short `AUTH_SECRET` crashes the
 * server immediately, before it ever accepts a request.
 *
 * Deliberately validates only the vars this app cannot run without
 * (`DATABASE_URL`, `AUTH_SECRET`, `CUSTOMER_AUTH_SECRET`,
 * `PLATFORM_ADMIN_AUTH_SECRET`, `APP_URL`).
 * `CUSTOMER_AUTH_SECRET` joined this required set in CAPP Phase 1 for the
 * same reason `AUTH_SECRET` is required, not optional: the customer mobile
 * app's entire auth surface (lib/customer-auth/session.ts) depends on it —
 * there is no "unconfigured" fallback for signing tokens, unlike the
 * provider-key vars below. `PLATFORM_ADMIN_AUTH_SECRET` joined for the
 * identical reason in Phase 17 — lib/platform-admin/session.ts has no
 * fallback either. This does mean an existing deployment that has never
 * touched Platform Subscription Billing must set this var to boot at all
 * once it upgrades past Phase 17 — the same one-time friction
 * `CUSTOMER_AUTH_SECRET` introduced for CAPP, accepted for the same reason:
 * a session-signing secret either exists and is long enough, or the whole
 * auth surface it protects is unsafe to serve traffic on. The provider-key vars
 * (`PAYMENT_PROVIDER_KEY`, `EMAIL_PROVIDER_KEY`, `STORAGE_PROVIDER_KEY`,
 * etc., see `.env.example`) are intentionally NOT required here — every
 * `get*Provider()` factory across this codebase (`lib/payments/`,
 * `lib/notifications/`, `lib/storage/`, `lib/ai/`) already handles an
 * absent key by falling back to its `Unconfigured*Provider` stub, which is
 * the correct behavior for a real deploy that simply hasn't wired in every
 * optional integration yet. Failing startup over an unset optional
 * provider key would contradict that whole "provider-agnostic, no fake
 * integrations" design (§59).
 */

import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .trim()
    .min(1, 'DATABASE_URL is required — see .env.example.')
    .refine(
      (v) => v.startsWith('postgresql://') || v.startsWith('postgres://'),
      'DATABASE_URL must be a postgresql:// connection string.',
    ),
  AUTH_SECRET: z
    .string()
    .min(16, 'AUTH_SECRET is not set (or too short). Generate one with: openssl rand -base64 48'),
  CUSTOMER_AUTH_SECRET: z
    .string()
    .min(
      16,
      'CUSTOMER_AUTH_SECRET is not set (or too short). Generate one with: openssl rand -base64 48',
    ),
  PLATFORM_ADMIN_AUTH_SECRET: z
    .string()
    .min(
      16,
      'PLATFORM_ADMIN_AUTH_SECRET is not set (or too short). Generate one with: openssl rand -base64 48',
    ),
  APP_URL: z
    .string()
    .trim()
    .min(1, 'APP_URL is required — see .env.example.')
    .url('APP_URL must be a valid URL.')
    .refine((v) => !v.endsWith('/'), 'APP_URL must not have a trailing slash.'),
});

export type ValidatedEnv = z.infer<typeof envSchema>;

/**
 * Validates `process.env` against `envSchema` and throws a single
 * multi-line, human-readable error listing every problem found (not just
 * the first) if validation fails. Safe to call more than once — cheap and
 * idempotent.
 */
export function validateEnv(): ValidatedEnv {
  const result = envSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    CUSTOMER_AUTH_SECRET: process.env.CUSTOMER_AUTH_SECRET,
    PLATFORM_ADMIN_AUTH_SECRET: process.env.PLATFORM_ADMIN_AUTH_SECRET,
    APP_URL: process.env.APP_URL,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid or missing environment variables — see .env.example:\n${issues}`,
    );
  }

  return result.data;
}
