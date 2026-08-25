import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { trialBalanceQuerySchema } from '@/lib/validation/accounting';
import { AccountingService } from '@/services/accounting/AccountingService';

/** Master spec §49's SUM(DEBITS) = SUM(CREDITS) proof, generated live from the posted ledger — see AccountingService.generateTrialBalance. */
export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_VIEW);
    const { searchParams } = new URL(request.url);
    const query = trialBalanceQuerySchema.parse({ asOfDate: searchParams.get('asOfDate') ?? undefined });
    const trialBalance = await AccountingService.generateTrialBalance(
      session.organizationId,
      query.asOfDate ? new Date(query.asOfDate) : undefined,
    );
    return NextResponse.json({ trialBalance });
  } catch (error) {
    return toErrorResponse(error);
  }
}
