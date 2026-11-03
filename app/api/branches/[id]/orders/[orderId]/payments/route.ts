import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { recordOrderPaymentSchema } from '@/lib/validation/order';
import { OrderService } from '@/services/orders/OrderService';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string; orderId: string }> }
) {
  const params = await props.params;
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
    // Phase 15 hardening: a payment-creation endpoint returning only the
    // parent order at 200 (not the created payment at 201) doesn't match
    // REST convention for a resource-creating POST. Kept additive rather
    // than replacing {order} — OrderService.recordPayment's return
    // contract (the full order) is relied on directly by several
    // integration tests and by invoice-service.test.ts, so this only adds
    // {payment} and bumps the status, without removing {order}.
    const payment = order.payments.reduce((latest, p) => (p.createdAt > latest.createdAt ? p : latest));
    return NextResponse.json({ order, payment }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
