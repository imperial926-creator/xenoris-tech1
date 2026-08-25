import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createIngredientSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const { searchParams } = new URL(request.url);
    const ingredients = await InventoryService.listIngredients(session.organizationId, searchParams.get('search') ?? undefined);
    return NextResponse.json({ ingredients });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = createIngredientSchema.parse(body);
    const ingredient = await InventoryService.createIngredient(session.organizationId, input, session.userId);
    return NextResponse.json({ ingredient }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
