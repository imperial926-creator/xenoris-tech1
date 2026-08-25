/** @type {import('next').NextConfig} */

// Phase 15 hardening (master spec §42 "Secure headers", §67 security
// review). Applied via next.config.js's headers() rather than
// middleware.ts, so these apply to every response Next.js serves
// (including static assets and pages middleware.ts's matcher doesn't
// cover) without an extra network hop per request. `script-src`/
// `style-src` include 'unsafe-inline' because this app has no CSP-nonce
// wiring through Next's App Router build pipeline yet and Tailwind/React
// both rely on inline styles in places — a real gap flagged here, not
// silently accepted as ideal: tightening this further requires nonce-based
// CSP support, which is a build-tooling change out of scope for this pass.
// This has not been runtime-verified (see CLAUDE.md → Known Issues, no
// npm install in this sandbox) — confirm no header breaks a real page load
// once the app is first run in an environment with network access.
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  // Only takes effect over HTTPS; harmless (ignored) over plain HTTP in local dev.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig = {
  reactStrictMode: true,
  // Phase 16: removes the `X-Powered-By: Next.js` response header (master
  // spec §63 observability / general hardening — don't advertise the
  // framework to every client for free).
  poweredByHeader: false,
  // Phase 16: standalone output produces a minimal, self-contained
  // `.next/standalone` server bundle (only the production deps it actually
  // needs, no full `node_modules`) — see `Dockerfile`, which copies exactly
  // that output. Documented in docs/deployment/README.md.
  output: 'standalone',
  // Business-critical data must never be silently stale; individual routes opt into
  // caching deliberately rather than relying on aggressive defaults.
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
    // Enables root-level instrumentation.ts's register() hook (see that
    // file — it runs lib/config/env.ts's fail-fast startup validation).
    // Flagged explicitly rather than assumed stable: this repo has never
    // been through `npm install`/`next build` in this sandbox (no network
    // access here, see CLAUDE.md → Known Issues), so whether this exact
    // Next 14.2.5 pin still requires the flag (it was stabilized in a
    // 14.x/15.x release) is unverified. Setting it is harmless either way
    // — a no-op if already stable, required if not — so it stays on
    // rather than silently risking instrumentation.ts never running.
    instrumentationHook: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

module.exports = nextConfig;
