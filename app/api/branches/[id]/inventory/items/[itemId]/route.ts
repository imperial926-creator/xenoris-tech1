import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateInventoryItemSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function GET(request: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const item = await InventoryService.getInventoryItem(session.organizationId, params.id, params.itemId);
    return NextResponse.json({ item });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = updateInventoryItemSchema.parse(body);
    const item = await InventoryService.updateInventoryItem(session.organizationId, params.id, params.itemId, input, session.userId);
    return NextResponse.json({ item });
  } catch (error) {
    return toErrorResponse(error);
  }
}
