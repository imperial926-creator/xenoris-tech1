import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { financialDashboardQuerySchema } from '@/lib/validation/reporting';
import { ReportingService } from '@/services/reporting/ReportingService';

/** Master spec §33/§53's financial dashboard figures — Today's Revenue/Expenses/Gross Profit/Net Profit plus Cash Position/Outstanding Receivables/Outstanding Payables/Inventory Value, all live-computed per §36 (no stale pre-aggregated summary table). Operational counts and analytics charts on the same spec sections are Phase 12's job. */
export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_VIEW);
    const { searchParams } = new URL(request.url);
    const query = financialDashboardQuerySchema.parse({ branchId: searchParams.get('branchId') ?? undefined });
    const dashboard = await ReportingService.getFinancialDashboard(session.organizationId, { branchId: query.branchId });
    return NextResponse.json({ dashboard });
  } catch (error) {
    return toErrorResponse(error);
  }
}
