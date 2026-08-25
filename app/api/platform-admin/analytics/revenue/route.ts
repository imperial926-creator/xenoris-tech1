import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { platformDateRangeQuerySchema } from '@/lib/validation/platform-analytics';
import { resolvePlatformDateRange, platformPreviousPeriod } from '@/lib/platform-analytics/date-range';
import { PlatformAnalyticsService } from '@/services/platform-analytics/PlatformAnalyticsService';

// VERY IMPORTANT (master spec, twice): `saasRevenue` and
// `restaurantGrossSales` are returned as two SEPARATE top-level objects —
// never sum them client-side. See PlatformAnalyticsService's header.
export async function GET(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'analytics');
    const q = request.nextUrl.searchParams;
    const query = platformDateRangeQuerySchema.parse({
      preset: q.get('preset') ?? undefined,
      customStart: q.get('customStart') ?? undefined,
      customEnd: q.get('customEnd') ?? undefined,
      compare: q.get('compare') ?? undefined,
    });
    const range = resolvePlatformDateRange(query.preset, new Date(), query.customStart, query.customEnd);

    const [saasRevenue, restaurantGrossSales, planPopularity, topRestaurants] = await Promise.all([
      PlatformAnalyticsService.revenueAnalytics(range),
      PlatformAnalyticsService.restaurantGrossSales(range),
      PlatformAnalyticsService.planPopularity(),
      PlatformAnalyticsService.topRestaurantsByMrr(),
    ]);

    let previousPeriodSaasRevenue = null;
    if (query.compare) {
      const previous = platformPreviousPeriod(range);
      previousPeriodSaasRevenue = await PlatformAnalyticsService.revenueAnalytics(previous);
    }

    return NextResponse.json({ saasRevenue, restaurantGrossSales, planPopularity, topRestaurants, previousPeriodSaasRevenue, range });
  } catch (error) {
    return toErrorResponse(error);
  }
}
