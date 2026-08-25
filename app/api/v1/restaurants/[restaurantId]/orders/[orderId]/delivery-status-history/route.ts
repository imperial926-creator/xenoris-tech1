import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { CustomerOrderService } from '@/services/customer/CustomerOrderService';
import { toErrorResponse } from '@/lib/utils/api-error';

// CAPP Phase 5 — delivery order tracking timeline (spec item 13, applied to
// delivery per spec § 12). 404s for a take-out order or another customer's
// order — see CustomerOrderService.getDeliveryStatusHistory's JSDoc.
export async function GET(
  request: NextRequest,
  { params }: { params: { restaurantId: string; orderId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const history = await CustomerOrderService.getDeliveryStatusHistory(
      params.restaurantId,
      session.customerAccountId,
      params.orderId,
    );
    return NextResponse.json({ history }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
