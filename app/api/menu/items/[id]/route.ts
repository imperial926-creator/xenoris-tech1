import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateMenuItemSchema } from '@/lib/validation/menu';
import { MenuService } from '@/services/menu/MenuService';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.MENU_VIEW);
    const item = await MenuService.getItem(session.organizationId, params.id);
    return NextResponse.json({ item });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.MENU_MANAGE);
    const body = await request.json();
    const input = updateMenuItemSchema.parse(body);
    const item = await MenuService.updateItem(session.organizationId, params.id, input, session.userId);
    return NextResponse.json({ item });
  } catch (error) {
    return toErrorResponse(error);
  }
}
