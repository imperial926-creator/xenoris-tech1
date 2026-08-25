import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { platformDateRangeQuerySchema } from '@/lib/validation/platform-analytics';
import { resolvePlatformDateRange } from '@/lib/platform-analytics/date-range';
import { PlatformHealthService } from '@/services/platform-analytics/PlatformHealthService';

// Master spec's "Platform Health" / "System Alerts" module — see
// PlatformHealthService's header for exactly which real events this covers.
export async function GET(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'technical');
    const q = request.nextUrl.searchParams;
    const query = platformDateRangeQuerySchema.parse({
      preset: q.get('preset') ?? undefined,
      customStart: q.get('customStart') ?? undefined,
      customEnd: q.get('customEnd') ?? undefined,
    });
    const range = resolvePlatformDateRange(query.preset, new Date(), query.customStart, query.customEnd);
    const [summary, recentEvents] = await Promise.all([
      PlatformHealthService.summary(range),
      PlatformHealthService.recentEvents({ limit: 100 }),
    ]);
    return NextResponse.json({ summary, recentEvents, range });
  } catch (error) {
    return toErrorResponse(error);
  }
}
