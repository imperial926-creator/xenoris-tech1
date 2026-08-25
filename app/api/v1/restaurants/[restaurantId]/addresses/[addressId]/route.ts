import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { updateCustomerAddressSchema } from '@/lib/validation/crm';
import { CustomerAddressService } from '@/services/customer/CustomerAddressService';
import { toErrorResponse } from '@/lib/utils/api-error';

// Ownership enforced inside CustomerAddressService.update/remove — an
// addressId belonging to another customer 404s exactly like a nonexistent
// one, same "don't leak existence" posture as the order/reservation detail
// routes.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { restaurantId: string; addressId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const body = await request.json();
    const input = updateCustomerAddressSchema.parse(body);
    const address = await CustomerAddressService.update(
      params.restaurantId,
      session.customerAccountId,
      params.addressId,
      input,
    );
    return NextResponse.json({ address }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { restaurantId: string; addressId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const result = await CustomerAddressService.remove(params.restaurantId, session.customerAccountId, params.addressId);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
