import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { aiInsightsQuerySchema } from '@/lib/validation/ai';
import { InsightService } from '@/services/ai/InsightService';

/**
 * Master spec Phase 13's AI Business Insights feed — deterministic,
 * template-based insights over sales/margin/expense/customer/product/
 * inventory/demand trends (see InsightService's own doc comment for why
 * this is a rule engine, not a call to an external model).
 *
 * Gated on both ANALYTICS_VIEW and FINANCE_VIEW, same reasoning as
 * app/api/analytics/profit/route.ts: several insight categories here
 * (margin change, expense trend, channel cost-vs-revenue divergence) are
 * sourced from the posted ledger via InsightService's profitAndMarginTool,
 * exactly the COGS/expense-derived data Phase 10 already withholds from
 * MANAGER (who has ANALYTICS_VIEW but not FINANCE_VIEW). Splitting this
 * single feed into a finance-gated half and an analytics-only half would
 * reopen that boundary through a new URL, so — like Profit — the whole
 * feed requires both.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ANALYTICS_VIEW);
    await requirePermission(session, PERMISSIONS.FINANCE_VIEW);
    const { searchParams } = new URL(request.url);
    const query = aiInsightsQuerySchema.parse({
      preset: searchParams.get('preset') ?? undefined,
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
      branchId: searchParams.get('branchId') ?? undefined,
    });
    const insights = await InsightService.generateInsights(session.organizationId, query);
    return NextResponse.json({ insights });
  } catch (error) {
    return toErrorResponse(error);
  }
}
