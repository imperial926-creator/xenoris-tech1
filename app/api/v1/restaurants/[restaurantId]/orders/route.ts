import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import {
  customerCreateOrderSchema,
  customerListOrdersQuerySchema,
} from '@/lib/validation/customer-order';
import { CustomerOrderService } from '@/services/customer/CustomerOrderService';
import { toErrorResponse } from '@/lib/utils/api-error';

/**
 * GET  — the diner's own take-out order history at this restaurant (spec
 *        § 1 item 18). Requires a valid customer session, same bearer-auth
 *        pattern as the reservations routes.
 * POST — places a take-out order (spec § 11). Server-computed pricing;
 *        see CustomerOrderService for why this never accepts item prices,
 *        a `type` other than TAKEOUT, or a completed payment.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { restaurantId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const { searchParams } = new URL(request.url);
    const query = customerListOrdersQuerySchema.parse({
      openOnly: searchParams.get('openOnly') ?? undefined,
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const orders = await CustomerOrderService.list(params.restaurantId, session.customerAccountId, query);
    return NextResponse.json({ orders }, { status: 200 });
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
    const input = customerCreateOrderSchema.parse(body);
    const order = await CustomerOrderService.createOrder(
      params.restaurantId,
      session.customerAccountId,
      input,
    );
    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
