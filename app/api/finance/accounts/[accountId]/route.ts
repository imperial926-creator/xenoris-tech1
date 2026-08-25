import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateAccountSchema } from '@/lib/validation/accounting';
import { AccountingService } from '@/services/accounting/AccountingService';

export async function PATCH(request: NextRequest, { params }: { params: { accountId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_MANAGE);
    const body = await request.json();
    const input = updateAccountSchema.parse(body);
    const account = await AccountingService.updateAccount(session.organizationId, params.accountId, input, session.userId);
    return NextResponse.json({ account });
  } catch (error) {
    return toErrorResponse(error);
  }
}
