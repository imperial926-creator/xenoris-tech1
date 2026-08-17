import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { balanceSheetQuerySchema } from '@/lib/validation/reporting';
import { ReportingService } from '@/services/reporting/ReportingService';

/** Master spec §35's Balance Sheet (Assets/Liabilities/Equity) as of a point in time, with unclosed net income folded into Equity — see ReportingService.generateBalanceSheet. */
export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_VIEW);
    const { searchParams } = new URL(request.url);
    const query = balanceSheetQuerySchema.parse({
      asOfDate: searchParams.get('asOfDate') ?? undefined,
      branchId: searchParams.get('branchId') ?? undefined,
    });
    const balanceSheet = await ReportingService.generateBalanceSheet(session.organizationId, {
      asOfDate: query.asOfDate ? new Date(query.asOfDate) : new Date(),
      branchId: query.branchId,
    });
    return NextResponse.json({ balanceSheet });
  } catch (error) {
    return toErrorResponse(error);
  }
}
