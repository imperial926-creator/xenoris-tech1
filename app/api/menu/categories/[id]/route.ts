import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateMenuCategorySchema } from '@/lib/validation/menu';
import { MenuService } from '@/services/menu/MenuService';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.MENU_MANAGE);
    const body = await request.json();
    const input = updateMenuCategorySchema.parse(body);
    const category = await MenuService.updateCategory(
      session.organizationId,
      params.id,
      input,
      session.userId,
    );
    return NextResponse.json({ category });
  } catch (error) {
    return toErrorResponse(error);
  }
}
