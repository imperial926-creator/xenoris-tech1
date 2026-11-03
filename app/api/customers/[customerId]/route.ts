import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateCustomerSchema } from '@/lib/validation/crm';
import { CustomerService } from '@/services/crm/CustomerService';

export async function GET(_request: NextRequest, props: { params: Promise<{ customerId: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_VIEW);
    const customer = await CustomerService.get(session.organizationId, params.customerId);
    return NextResponse.json({ customer });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ customerId: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_MANAGE);
    const body = await request.json();
    const input = updateCustomerSchema.parse(body);
    const customer = await CustomerService.update(session.organizationId, params.customerId, input, session.userId);
    return NextResponse.json({ customer });
  } catch (error) {
    return toErrorResponse(error);
  }
}
