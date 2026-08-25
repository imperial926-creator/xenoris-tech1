import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { platformDateRangeQuerySchema } from '@/lib/validation/platform-analytics';
import { resolvePlatformDateRange } from '@/lib/platform-analytics/date-range';
import { PlatformAnalyticsService } from '@/services/platform-analytics/PlatformAnalyticsService';

// Master spec's App Usage / Feature Analytics + aggregated Customer Analytics.
export async function GET(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'analytics');
    const q = request.nextUrl.searchParams;
    const query = platformDateRangeQuerySchema.parse({
      preset: q.get('preset') ?? undefined,
      customStart: q.get('customStart') ?? undefined,
      customEnd: q.get('customEnd') ?? undefined,
    });
    const range = resolvePlatformDateRange(query.preset, new Date(), query.customStart, query.customEnd);

    const [appUsage, featureUsage, customerAnalytics] = await Promise.all([
      PlatformAnalyticsService.appUsageAnalytics(range.endDate),
      PlatformAnalyticsService.featureUsageRanking(range),
      PlatformAnalyticsService.customerAnalytics(range),
    ]);

    return NextResponse.json({ appUsage, featureUsage, customerAnalytics, range });
  } catch (error) {
    return toErrorResponse(error);
  }
}
