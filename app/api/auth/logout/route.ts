import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth/session';
import { toErrorResponse } from '@/lib/utils/api-error';

// Phase 15 hardening: was the one route in the whole tree without the
// try/catch + toErrorResponse convention every other route follows — an
// unexpected failure in clearSessionCookie (e.g. a cookies() call that
// throws outside a request context) would have surfaced as an unhandled
// 500 with a framework-default error page/body instead of this app's
// consistent JSON error shape.
export async function POST() {
  try {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
