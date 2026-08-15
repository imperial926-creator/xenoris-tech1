import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createCustomerAddressSchema } from '@/lib/validation/crm';
import { CustomerService } from '@/services/crm/CustomerService';

export async function POST(request: NextRequest, { params }: { params: { customerId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_MANAGE);
    const body = await request.json();
    const input = createCustomerAddressSchema.parse(body);
    const address = await CustomerService.addAddress(session.organizationId, params.customerId, input, session.userId);
    return NextResponse.json({ address }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
