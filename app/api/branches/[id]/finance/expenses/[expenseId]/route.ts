import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { AccountingService } from '@/services/accounting/AccountingService';

export async function GET(request: NextRequest, { params }: { params: { id: string; expenseId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_VIEW);
    const expense = await AccountingService.getExpense(session.organizationId, params.id, params.expenseId);
    return NextResponse.json({ expense });
  } catch (error) {
    return toErrorResponse(error);
  }
}
