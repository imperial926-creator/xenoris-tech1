import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { AccountingService } from '@/services/accounting/AccountingService';

/** Posts Debit category.defaultAccount / Credit Cash-or-Bank — see AccountingService.approveExpense. */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string; expenseId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_MANAGE);
    const expense = await AccountingService.approveExpense(session.organizationId, params.id, params.expenseId, session.userId);
    return NextResponse.json({ expense });
  } catch (error) {
    return toErrorResponse(error);
  }
}
