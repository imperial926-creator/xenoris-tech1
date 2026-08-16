import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { AccountingService } from '@/services/accounting/AccountingService';

/** Refuses if any DRAFT entry is still dated inside the period — see AccountingService.closePeriod. */
export async function POST(request: NextRequest, { params }: { params: { periodId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_MANAGE);
    const period = await AccountingService.closePeriod(session.organizationId, params.periodId, session.userId);
    return NextResponse.json({ period });
  } catch (error) {
    return toErrorResponse(error);
  }
}
