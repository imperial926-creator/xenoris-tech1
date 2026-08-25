import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { CustomerOrderService } from '@/services/customer/CustomerOrderService';
import { toErrorResponse } from '@/lib/utils/api-error';

// Single-order detail — scoped to the requesting diner inside
// CustomerOrderService.get, so requesting another customer's orderId 404s
// exactly like it not existing (same "don't leak existence" posture as the
// reservation detail route).
export async function GET(
  request: NextRequest,
  { params }: { params: { restaurantId: string; orderId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const order = await CustomerOrderService.get(
      params.restaurantId,
      session.customerAccountId,
      params.orderId,
    );
    return NextResponse.json({ order }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
