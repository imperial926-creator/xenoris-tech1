import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createPurchaseOrderSchema, listPurchaseOrdersQuerySchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const { searchParams } = new URL(request.url);
    const query = listPurchaseOrdersQuerySchema.parse({
      status: searchParams.get('status') ?? undefined,
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const purchaseOrders = await InventoryService.listPurchaseOrders(session.organizationId, params.id, query);
    return NextResponse.json({ purchaseOrders });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = createPurchaseOrderSchema.parse(body);
    const purchaseOrder = await InventoryService.createPurchaseOrder(session.organizationId, params.id, input, session.userId);
    return NextResponse.json({ purchaseOrder }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
