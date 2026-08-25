import { NextRequest, NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/utils/api-error';
import { platformAdminLoginSchema } from '@/lib/validation/platform-billing';
import { PlatformAdminAuthService } from '@/services/platform-billing/PlatformAdminAuthService';
import { setPlatformAdminSessionCookie } from '@/lib/platform-admin/session';

// Master spec §3: this login exists ONLY for the SaaS Owner / Platform
// Administrator — there is no public registration endpoint anywhere in
// this file tree for this role (see PlatformAdminAuthService's header).
// Rate-limited via middleware.ts's RATE_LIMITED_AUTH_PREFIXES, same
// brute-force protection as the staff and customer-app login routes.
export async function POST(request: NextRequest) {
  try {
    const body = platformAdminLoginSchema.parse(await request.json());
    const { token } = await PlatformAdminAuthService.login(body);
    await setPlatformAdminSessionCookie(token);
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
