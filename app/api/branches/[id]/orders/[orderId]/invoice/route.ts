import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { InvoiceService } from '@/services/invoicing/InvoiceService';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string; orderId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ORDER_MANAGE);
    const invoice = await InvoiceService.issueInvoice(
      session.organizationId,
      params.id,
      params.orderId,
      session.userId,
    );
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
