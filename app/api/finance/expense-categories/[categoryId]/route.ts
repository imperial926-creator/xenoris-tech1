import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateExpenseCategorySchema } from '@/lib/validation/accounting';
import { AccountingService } from '@/services/accounting/AccountingService';

export async function PATCH(request: NextRequest, { params }: { params: { categoryId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_MANAGE);
    const body = await request.json();
    const input = updateExpenseCategorySchema.parse(body);
    const category = await AccountingService.updateExpenseCategory(session.organizationId, params.categoryId, input, session.userId);
    return NextResponse.json({ category });
  } catch (error) {
    return toErrorResponse(error);
  }
}
