import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { PlatformInvoiceService } from '@/services/platform-billing/PlatformInvoiceService';

export async function GET(_request: NextRequest, { params }: { params: { invoiceId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.BILLING_VIEW);
    const invoice = await PlatformInvoiceService.get(session.organizationId, params.invoiceId);
    return NextResponse.json({ invoice });
  } catch (error) {
    return toErrorResponse(error);
  }
}
