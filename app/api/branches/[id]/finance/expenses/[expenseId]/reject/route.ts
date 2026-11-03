import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { rejectExpenseSchema } from '@/lib/validation/accounting';
import { AccountingService } from '@/services/accounting/AccountingService';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string; expenseId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_MANAGE);
    const body = await request.json();
    const input = rejectExpenseSchema.parse(body);
    const expense = await AccountingService.rejectExpense(session.organizationId, params.id, params.expenseId, input, session.userId);
    return NextResponse.json({ expense });
  } catch (error) {
    return toErrorResponse(error);
  }
}
