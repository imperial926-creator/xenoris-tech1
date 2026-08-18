import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateCustomerAddressSchema } from '@/lib/validation/crm';
import { CustomerService } from '@/services/crm/CustomerService';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { customerId: string; addressId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_MANAGE);
    const body = await request.json();
    const input = updateCustomerAddressSchema.parse(body);
    const address = await CustomerService.updateAddress(
      session.organizationId, params.customerId, params.addressId, input, session.userId,
    );
    return NextResponse.json({ address });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { customerId: string; addressId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_MANAGE);
    // Phase 15 hardening: was {result}, unlike every other DELETE route in
    // this tree, which names the key after the deleted resource (e.g.
    // DELETE /branches/[id] returns {branch}). The customer-board UI
    // doesn't read this response body at all (it just re-fetches the
    // profile), so this is a clean rename, not a breaking one.
    const address = await CustomerService.deleteAddress(
      session.organizationId, params.customerId, params.addressId, session.userId,
    );
    return NextResponse.json({ address });
  } catch (error) {
    return toErrorResponse(error);
  }
}
