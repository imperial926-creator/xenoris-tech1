import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { voidInvoiceSchema } from '@/lib/validation/order';
import { InvoiceService } from '@/services/invoicing/InvoiceService';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string; invoiceId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ORDER_MANAGE);
    const body = await request.json();
    const input = voidInvoiceSchema.parse(body);
    const invoice = await InvoiceService.voidInvoice(
      session.organizationId,
      params.id,
      params.invoiceId,
      input,
      session.userId,
    );
    return NextResponse.json({ invoice });
  } catch (error) {
    return toErrorResponse(error);
  }
}
