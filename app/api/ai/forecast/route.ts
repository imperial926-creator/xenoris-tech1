import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { aiForecastQuerySchema } from '@/lib/validation/ai';
import { InsightService } from '@/services/ai/InsightService';

/**
 * Master spec Phase 13's "Forecasting where appropriate" — a naive linear
 * projection of the revenue trend (InsightService.forecastRevenue's own
 * doc comment covers the method and why it's revenue-only). Gated the same
 * as /api/ai/insights: a revenue forecast alone doesn't touch the ledger,
 * but it's part of the same AI Business Insights feature surfaced
 * alongside margin/expense insights on one dashboard, so it shares that
 * dashboard's permission boundary rather than introducing a partial one.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ANALYTICS_VIEW);
    await requirePermission(session, PERMISSIONS.FINANCE_VIEW);
    const { searchParams } = new URL(request.url);
    const query = aiForecastQuerySchema.parse({
      preset: searchParams.get('preset') ?? undefined,
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
      branchId: searchParams.get('branchId') ?? undefined,
      periodsAhead: searchParams.get('periodsAhead') ?? undefined,
    });
    const forecast = await InsightService.forecastRevenue(session.organizationId, query);
    return NextResponse.json({ forecast });
  } catch (error) {
    return toErrorResponse(error);
  }
}
