import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { OrderService } from '@/services/orders/OrderService';

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ id: string; orderId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ORDER_MANAGE);
    const order = await OrderService.get(session.organizationId, params.id, params.orderId);
    const payment = OrderService.paymentSummary(order);
    return NextResponse.json({ order, payment });
  } catch (error) {
    return toErrorResponse(error);
  }
}
