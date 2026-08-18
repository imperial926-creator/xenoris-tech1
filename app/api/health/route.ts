import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { log } from '@/lib/monitoring/logger';

/**
 * Liveness/readiness endpoint (master spec §63 "Observability": "API
 * monitoring" / "Database monitoring", and §60's production deploy
 * sequence, which places `Monitoring` right after `Application
 * deployment`). Deliberately unauthenticated — it's an infra-facing
 * endpoint meant for a load balancer's health check, Docker's `HEALTHCHECK`
 * (see `Dockerfile`), or an external uptime monitor, none of which carry a
 * session cookie. Requiring auth here would just mean the infra tooling
 * needs its own service-account credentials for zero security benefit: this
 * route intentionally reveals nothing beyond "is the app up and can it
 * reach its database" — no user data, no internal error detail in the
 * response body (full detail is logged server-side via
 * `lib/monitoring/logger.ts` instead, same discipline as
 * `lib/utils/api-error.ts`'s `toErrorResponse`).
 *
 * Still passes through `middleware.ts`'s general `/api/*` rate limit (120
 * req/min) like every other API route — generous enough for any real
 * health-check interval (Docker's default is 30s) while still providing
 * defense-in-depth against a misconfigured monitor hammering it.
 *
 * `force-dynamic` ensures Next.js never statically caches this route — a
 * stale cached "ok" would defeat the entire point of a liveness check.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  try {
    // A trivial round-trip query, not a real table read — proves the
    // connection pool can reach Postgres and get a response, which is all
    // a liveness check needs to know.
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'ok',
      database: 'ok',
      timestamp: new Date().toISOString(),
      responseTimeMs: Date.now() - startedAt,
    });
  } catch (error) {
    log.error('Health check: database unreachable', error);
    return NextResponse.json(
      {
        status: 'error',
        database: 'unreachable',
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
