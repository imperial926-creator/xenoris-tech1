import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createJournalEntrySchema, listJournalEntriesQuerySchema } from '@/lib/validation/accounting';
import { AccountingService } from '@/services/accounting/AccountingService';

export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_VIEW);
    const { searchParams } = new URL(request.url);
    const query = listJournalEntriesQuerySchema.parse({
      branchId: searchParams.get('branchId') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      accountId: searchParams.get('accountId') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const entries = await AccountingService.listJournalEntries(session.organizationId, query);
    return NextResponse.json({ entries });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Manual (accountant-authored) journal entry — created as DRAFT; POST /post separately advances it. */
export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_MANAGE);
    const body = await request.json();
    const input = createJournalEntrySchema.parse(body);
    const entry = await AccountingService.createJournalEntry(session.organizationId, input, session.userId);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
