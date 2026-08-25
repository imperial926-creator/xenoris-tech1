import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createMenuItemVariantSchema } from '@/lib/validation/menu';
import { MenuService } from '@/services/menu/MenuService';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.MENU_MANAGE);
    const body = await request.json();
    const input = createMenuItemVariantSchema.parse(body);
    const variant = await MenuService.addVariant(session.organizationId, params.id, input, session.userId);
    return NextResponse.json({ variant }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
