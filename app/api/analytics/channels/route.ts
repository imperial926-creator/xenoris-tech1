import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { analyticsQuerySchema } from '@/lib/validation/analytics';
import { AnalyticsService } from '@/services/analytics/AnalyticsService';

/** Master spec Phase 12's Channel analytics — revenue/order count by Order.type plus catering, and sales by hour-of-day/day-of-week. */
export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ANALYTICS_VIEW);
    const { searchParams } = new URL(request.url);
    const query = analyticsQuerySchema.parse({
      preset: searchParams.get('preset') ?? undefined,
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
      branchId: searchParams.get('branchId') ?? undefined,
    });
    const channels = await AnalyticsService.getChannelAnalytics(session.organizationId, query);
    return NextResponse.json({ channels });
  } catch (error) {
    return toErrorResponse(error);
  }
}
