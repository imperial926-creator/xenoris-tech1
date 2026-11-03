import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { AccountingService } from '@/services/accounting/AccountingService';

export async function GET(request: NextRequest, props: { params: Promise<{ entryId: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_VIEW);
    const entry = await AccountingService.getJournalEntry(session.organizationId, params.entryId);
    return NextResponse.json({ entry });
  } catch (error) {
    return toErrorResponse(error);
  }
}
