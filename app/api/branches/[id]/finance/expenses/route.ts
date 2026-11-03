import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createExpenseSchema, listExpensesQuerySchema } from '@/lib/validation/accounting';
import { AccountingService } from '@/services/accounting/AccountingService';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_VIEW);
    const { searchParams } = new URL(request.url);
    const query = listExpensesQuerySchema.parse({
      approvalStatus: searchParams.get('approvalStatus') ?? undefined,
      categoryId: searchParams.get('categoryId') ?? undefined,
      vendorId: searchParams.get('vendorId') ?? undefined,
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const expenses = await AccountingService.listExpenses(session.organizationId, params.id, query);
    return NextResponse.json({ expenses });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Created as PENDING — approveExpense (below) is the one code path that ever posts it to the ledger. */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_MANAGE);
    const body = await request.json();
    const input = createExpenseSchema.parse(body);
    const expense = await AccountingService.createExpense(session.organizationId, params.id, input, session.userId);
    return NextResponse.json({ expense }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
