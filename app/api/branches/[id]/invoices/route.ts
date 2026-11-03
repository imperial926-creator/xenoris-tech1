import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { InvoiceService } from '@/services/invoicing/InvoiceService';

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ORDER_MANAGE);
    const invoices = await InvoiceService.list(session.organizationId, params.id);
    return NextResponse.json({ invoices });
  } catch (error) {
    return toErrorResponse(error);
  }
}
