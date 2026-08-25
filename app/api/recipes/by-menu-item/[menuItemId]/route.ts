import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { InventoryService } from '@/services/inventory/InventoryService';

/**
 * Convenience lookup so the menu/inventory UI can ask "does this menu item
 * already have a recipe?" (to show an Edit vs. Create action) without
 * needing to know a recipeId up front. Returns { recipe: null } rather than
 * 404 when none exists — the absence of a recipe is a normal, expected
 * state (most menu items may never get one), not an error.
 */
export async function GET(request: NextRequest, { params }: { params: { menuItemId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const recipe = await InventoryService.getRecipeByMenuItem(session.organizationId, params.menuItemId);
    return NextResponse.json({ recipe });
  } catch (error) {
    return toErrorResponse(error);
  }
}
