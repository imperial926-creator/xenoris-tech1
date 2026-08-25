import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { MenuService } from '@/services/menu/MenuService';

export async function DELETE(_request: NextRequest, { params }: { params: { id: string; recommendationId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.MENU_MANAGE);
    const result = await MenuService.removeRecommendation(session.organizationId, params.id, params.recommendationId, session.userId);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
