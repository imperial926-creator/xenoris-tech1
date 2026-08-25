import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateIngredientSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function GET(request: NextRequest, { params }: { params: { ingredientId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const ingredient = await InventoryService.getIngredient(session.organizationId, params.ingredientId);
    return NextResponse.json({ ingredient });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { ingredientId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = updateIngredientSchema.parse(body);
    const ingredient = await InventoryService.updateIngredient(session.organizationId, params.ingredientId, input, session.userId);
    return NextResponse.json({ ingredient });
  } catch (error) {
    return toErrorResponse(error);
  }
}
