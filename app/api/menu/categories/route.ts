import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createMenuCategorySchema } from '@/lib/validation/menu';
import { MenuService } from '@/services/menu/MenuService';

export async function GET() {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.MENU_VIEW);
    const categories = await MenuService.listCategories(session.organizationId);
    return NextResponse.json({ categories });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.MENU_MANAGE);
    const body = await request.json();
    const input = createMenuCategorySchema.parse(body);
    const category = await MenuService.createCategory(session.organizationId, input, session.userId);
    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
