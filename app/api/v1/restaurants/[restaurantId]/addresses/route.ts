import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { createCustomerAddressSchema } from '@/lib/validation/crm';
import { CustomerAddressService } from '@/services/customer/CustomerAddressService';
import { toErrorResponse } from '@/lib/utils/api-error';

/**
 * CAPP Phase 5 — a diner's saved delivery addresses at this restaurant
 * (spec § 1 item 23, "Save addresses"). Bearer-auth gated, same pattern as
 * the orders/reservations routes — an address book is personal data, never
 * a public read.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { restaurantId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const addresses = await CustomerAddressService.list(params.restaurantId, session.customerAccountId);
    return NextResponse.json({ addresses }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { restaurantId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const body = await request.json();
    const input = createCustomerAddressSchema.parse(body);
    const address = await CustomerAddressService.create(params.restaurantId, session.customerAccountId, input);
    return NextResponse.json({ address }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
