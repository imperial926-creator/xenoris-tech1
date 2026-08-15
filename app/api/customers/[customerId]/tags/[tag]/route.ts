import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { CustomerService } from '@/services/crm/CustomerService';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { customerId: string; tag: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_MANAGE);
    const result = await CustomerService.removeTag(
      session.organizationId, params.customerId, decodeURIComponent(params.tag), session.userId,
    );
    return NextResponse.json({ result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
