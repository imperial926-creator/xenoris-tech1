import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { recordOrderPaymentSchema } from '@/lib/validation/order';
import { OrderService } from '@/services/orders/OrderService';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; orderId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ORDER_MANAGE);
    const body = await request.json();
    const input = recordOrderPaymentSchema.parse(body);
    const order = await OrderService.recordPayment(
      session.organizationId,
      params.id,
      params.orderId,
      input,
      session.userId,
    );
    return NextResponse.json({ order });
  } catch (error) {
    return toErrorResponse(error);
  }
}
