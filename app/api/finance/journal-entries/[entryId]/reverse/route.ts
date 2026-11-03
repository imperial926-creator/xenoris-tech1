import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { reverseJournalEntrySchema } from '@/lib/validation/accounting';
import { AccountingService } from '@/services/accounting/AccountingService';

/**
 * The only way to correct a POSTED entry (master spec §27) — creates a
 * brand-new POSTED entry with every line's debit/credit swapped, and flips
 * the original's status to REVERSED. See AccountingService.reverseJournalEntry.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ entryId: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_MANAGE);
    const body = await request.json();
    const input = reverseJournalEntrySchema.parse(body);
    const reversal = await AccountingService.reverseJournalEntry(session.organizationId, params.entryId, input, session.userId);
    return NextResponse.json({ reversal });
  } catch (error) {
    return toErrorResponse(error);
  }
}
