import { NextRequest, NextResponse } from 'next/server';
import { SubscriptionRetryService } from '@/services/platform-billing/SubscriptionRetryService';
import { log } from '@/lib/monitoring/logger';

/**
 * Called by an EXTERNAL scheduler (real cron, a PaaS's built-in cron, or a
 * manual ops trigger) — never by anything inside this Next.js app itself,
 * since this codebase has no background job runner (see
 * SubscriptionRetryService's header for the full reasoning). Guarded by a
 * shared secret rather than a session, because the caller here is a
 * scheduler, not a logged-in platform admin with a browser cookie.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.PLATFORM_CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const result = await SubscriptionRetryService.runDueRetries();
    return NextResponse.json(result);
  } catch (error) {
    log.error('Subscription retry cron run failed', error);
    return NextResponse.json({ error: 'Retry run failed.' }, { status: 500 });
  }
}
