import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { AccountingService } from '@/services/accounting/AccountingService';

export async function GET() {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_VIEW);
    const periods = await AccountingService.listPeriods(session.organizationId);
    return NextResponse.json({ periods });
  } catch (error) {
    return toErrorResponse(error);
  }
}
