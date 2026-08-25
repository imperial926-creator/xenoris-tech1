import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createMenuItemSchema } from '@/lib/validation/menu';
import { MenuService } from '@/services/menu/MenuService';

export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.MENU_VIEW);
    const categoryId = request.nextUrl.searchParams.get('categoryId') ?? undefined;
    const items = await MenuService.listItems(session.organizationId, categoryId);
    return NextResponse.json({ items });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.MENU_MANAGE);
    const body = await request.json();
    const input = createMenuItemSchema.parse(body);
    const item = await MenuService.createItem(session.organizationId, input, session.userId);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
