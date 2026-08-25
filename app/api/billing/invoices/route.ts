import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { PlatformInvoiceService } from '@/services/platform-billing/PlatformInvoiceService';

// Master spec §48: restaurant owner's own payment history/invoices/receipts.
export async function GET(_request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.BILLING_VIEW);
    const invoices = await PlatformInvoiceService.listForOrganization(session.organizationId);
    return NextResponse.json({ invoices });
  } catch (error) {
    return toErrorResponse(error);
  }
}
