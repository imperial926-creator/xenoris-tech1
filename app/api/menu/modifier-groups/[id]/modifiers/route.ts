import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createModifierSchema } from '@/lib/validation/menu';
import { MenuService } from '@/services/menu/MenuService';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.MENU_MANAGE);
    const body = await request.json();
    const input = createModifierSchema.parse(body);
    const modifier = await MenuService.addModifier(session.organizationId, params.id, input, session.userId);
    return NextResponse.json({ modifier }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
