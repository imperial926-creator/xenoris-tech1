import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { analyticsQuerySchema } from '@/lib/validation/analytics';
import { AnalyticsService } from '@/services/analytics/AnalyticsService';

/**
 * Master spec Phase 12's Profit dashboard — bucketed gross/net profit trend,
 * generated from the posted ledger via ReportingService (see
 * AnalyticsService.getProfitDashboard's doc comment), not from Order/
 * OrderItem directly.
 *
 * Gated on FINANCE_VIEW in addition to ANALYTICS_VIEW — a deliberate
 * departure from every other analytics route below, which only requires
 * ANALYTICS_VIEW. Phase 10 already withholds margin/COGS/expense data from
 * MANAGER (who has ANALYTICS_VIEW but not FINANCE_VIEW); this dashboard
 * surfaces exactly that COGS/expense-derived figure, so it must respect the
 * same boundary rather than reopening it through a new URL.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ANALYTICS_VIEW);
    await requirePermission(session, PERMISSIONS.FINANCE_VIEW);
    const { searchParams } = new URL(request.url);
    const query = analyticsQuerySchema.parse({
      preset: searchParams.get('preset') ?? undefined,
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
      branchId: searchParams.get('branchId') ?? undefined,
    });
    const profit = await AnalyticsService.getProfitDashboard(session.organizationId, query);
    return NextResponse.json({ profit });
  } catch (error) {
    return toErrorResponse(error);
  }
}
