import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { InvoiceService } from '@/services/invoicing/InvoiceService';

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ id: string; invoiceId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ORDER_MANAGE);
    const invoice = await InvoiceService.get(session.organizationId, params.id, params.invoiceId);
    return NextResponse.json({ invoice });
  } catch (error) {
    return toErrorResponse(error);
  }
}
