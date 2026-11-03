import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createOrderSchema, listOrdersQuerySchema } from '@/lib/validation/order';
import { OrderService } from '@/services/orders/OrderService';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ORDER_MANAGE);
    const { searchParams } = new URL(request.url);
    const query = listOrdersQuerySchema.parse({
      status: searchParams.get('status') ?? undefined,
      type: searchParams.get('type') ?? undefined,
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const orders = await OrderService.list(session.organizationId, params.id, query);
    return NextResponse.json({ orders });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ORDER_MANAGE);
    const body = await request.json();
    const input = createOrderSchema.parse(body);
    const order = await OrderService.createOrder(session.organizationId, params.id, input, session.userId);
    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
