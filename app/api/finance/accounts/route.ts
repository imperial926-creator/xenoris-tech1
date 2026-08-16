import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createAccountSchema, listAccountsQuerySchema } from '@/lib/validation/accounting';
import { AccountingService } from '@/services/accounting/AccountingService';

export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_VIEW);
    const { searchParams } = new URL(request.url);
    const query = listAccountsQuerySchema.parse({
      type: searchParams.get('type') ?? undefined,
      includeInactive: searchParams.get('includeInactive') ?? undefined,
    });
    const accounts = await AccountingService.listAccounts(session.organizationId, query);
    return NextResponse.json({ accounts });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_MANAGE);
    const body = await request.json();
    const input = createAccountSchema.parse(body);
    const account = await AccountingService.createAccount(session.organizationId, input, session.userId);
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
