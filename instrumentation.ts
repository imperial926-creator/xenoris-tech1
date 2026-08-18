/**
 * Next.js instrumentation hook — runs once when a new server instance
 * boots (App Router convention: a `register()` export from a root-level
 * `instrumentation.ts`). This is the wiring point for `lib/config/env.ts`'s
 * `validateEnv()`, satisfying master spec §60's deploy-sequence step
 * "Environment variables" as an actual startup gate rather than only
 * documentation: a production process with a missing `DATABASE_URL` or a
 * too-short `AUTH_SECRET` now crashes immediately on boot instead of
 * serving requests into a broken configuration.
 *
 * Guarded to the Node.js runtime only — this project has no Edge Runtime
 * routes today (see `middleware.ts`, which runs on Edge but does not read
 * these vars), but `register()` fires for every runtime Next.js starts, and
 * `validateEnv()` uses plain Node-available APIs (`process.env`) that are
 * not guaranteed identical across runtimes, so this stays intentionally
 * scoped to avoid double-validating or validating somewhere the message
 * would be less visible.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('./lib/config/env');
    validateEnv();
  }
}
