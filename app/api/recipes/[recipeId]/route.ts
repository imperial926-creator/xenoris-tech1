import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateRecipeSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function GET(request: NextRequest, { params }: { params: { recipeId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const recipe = await InventoryService.getRecipe(session.organizationId, params.recipeId);
    return NextResponse.json({ recipe });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { recipeId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = updateRecipeSchema.parse(body);
    const recipe = await InventoryService.updateRecipe(session.organizationId, params.recipeId, input, session.userId);
    return NextResponse.json({ recipe });
  } catch (error) {
    return toErrorResponse(error);
  }
}
