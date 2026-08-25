import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updatePurchaseOrderSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function GET(request: NextRequest, { params }: { params: { id: string; poId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const purchaseOrder = await InventoryService.getPurchaseOrder(session.organizationId, params.id, params.poId);
    return NextResponse.json({ purchaseOrder });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string; poId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = updatePurchaseOrderSchema.parse(body);
    const purchaseOrder = await InventoryService.updatePurchaseOrder(session.organizationId, params.id, params.poId, input, session.userId);
    return NextResponse.json({ purchaseOrder });
  } catch (error) {
    return toErrorResponse(error);
  }
}
