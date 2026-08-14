import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { linkModifierGroupSchema } from '@/lib/validation/menu';
import { MenuService } from '@/services/menu/MenuService';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.MENU_MANAGE);
    const body = await request.json();
    const input = linkModifierGroupSchema.parse(body);
    const link = await MenuService.linkModifierGroupToItem(
      session.organizationId,
      params.id,
      input.modifierGroupId,
      session.userId,
    );
    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
