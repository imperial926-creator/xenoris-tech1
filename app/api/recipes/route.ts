import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createRecipeSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = createRecipeSchema.parse(body);
    const recipe = await InventoryService.createRecipe(session.organizationId, input, session.userId);
    return NextResponse.json({ recipe }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
