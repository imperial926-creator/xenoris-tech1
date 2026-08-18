/**
 * Minimal fixed-window rate limiter for `middleware.ts` — Phase 15
 * hardening (master spec §42 "Rate limiting", §67 security review). Runs
 * on the Edge runtime alongside the rest of `middleware.ts`, so it can only
 * use Web-standard APIs (no Node-only deps, no Prisma/Redis).
 *
 * KNOWN LIMITATION, stated plainly: this is a process-local in-memory
 * counter, not a shared store. It is correct for a single server instance
 * (the only deployment topology this build has been verified against — see
 * CLAUDE.md → Known Issues) but does NOT enforce a real limit across
 * multiple horizontally-scaled instances, each of which gets its own
 * independent counter. Before scaling this app past one instance, replace
 * `hits` with a shared store (e.g. Upstash Redis, which has an Edge-
 * compatible client) behind the exact same `checkRateLimit` signature so no
 * call site needs to change. Flagged here rather than silently shipped as
 * if it were a complete solution.
 */

interface Bucket {
  count: number;
  windowStartMs: number;
}

// Module-level state persists for the lifetime of the Edge runtime
// instance/isolate — reset on redeploy or isolate recycling, which is an
// acceptable failure mode for a rate limiter (fails open to "reset", never
// fails closed to "permanently blocked").
const buckets = new Map<string, Bucket>();

// Bound memory: an unbounded Map keyed by client IP is itself a resource-
// exhaustion vector under a distributed-IP attack. Evict the oldest entries
// once the map grows past this size rather than growing forever.
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the caller should wait before retrying, only meaningful when `allowed` is false. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter: `key` gets `limit` requests per `windowMs`. Once
 * exceeded, every request within the remaining window is rejected; the
 * counter resets at the next window boundary.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number, nowMs: number): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || nowMs - existing.windowStartMs >= windowMs) {
    if (buckets.size >= MAX_TRACKED_KEYS && !existing) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) buckets.delete(oldestKey);
    }
    buckets.set(key, { count: 1, windowStartMs: nowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    const retryAfterSeconds = Math.ceil((existing.windowStartMs + windowMs - nowMs) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Best-effort client identifier for rate-limiting purposes only — never
 * used for authorization or audit-log identity (that stays session-based).
 * `x-forwarded-for` is attacker-controllable on a request that reaches this
 * app directly, but is trustworthy behind the reverse proxy/load balancer
 * any real deployment of this app sits behind (see docs/architecture.md).
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for');
  const firstForwarded = forwardedFor?.split(',')[0]?.trim();
  if (firstForwarded) return firstForwarded;
  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}
