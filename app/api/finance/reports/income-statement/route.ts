import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { reportDateRangeQuerySchema } from '@/lib/validation/reporting';
import { ReportingService } from '@/services/reporting/ReportingService';

/** Master spec §35's Income Statement — Revenue − COGS = Gross Profit; − Operating Expenses = Net Profit, generated live from posted ledger entries. Date range per §54's preset filters. */
export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_VIEW);
    const { searchParams } = new URL(request.url);
    const query = reportDateRangeQuerySchema.parse({
      preset: searchParams.get('preset') ?? undefined,
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
      branchId: searchParams.get('branchId') ?? undefined,
    });
    const range = await ReportingService.resolveReportDateRange(session.organizationId, query);
    const incomeStatement = await ReportingService.generateIncomeStatement(session.organizationId, {
      ...range,
      branchId: query.branchId,
    });
    return NextResponse.json({ incomeStatement });
  } catch (error) {
    return toErrorResponse(error);
  }
}
