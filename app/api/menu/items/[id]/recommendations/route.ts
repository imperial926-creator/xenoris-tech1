import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createMenuItemRecommendationSchema } from '@/lib/validation/menu-recommendation';
import { MenuService } from '@/services/menu/MenuService';

/**
 * CAPP Phase 10 — spec § 39 "Upselling." Staff-managed via the existing
 * MENU_VIEW/MENU_MANAGE permissions (this is menu configuration, not a new
 * concern), no new dashboard page — same established CAPP boundary every
 * phase since 8 has followed.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.MENU_VIEW);
    const recommendations = await MenuService.listRecommendations(session.organizationId, params.id);
    return NextResponse.json({ recommendations });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.MENU_MANAGE);
    const body = await request.json();
    const input = createMenuItemRecommendationSchema.parse(body);
    const recommendation = await MenuService.addRecommendation(session.organizationId, params.id, input, session.userId);
    return NextResponse.json({ recommendation }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
