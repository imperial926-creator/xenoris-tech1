import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updatePromotionSchema } from '@/lib/validation/promotion';
import { PromotionService } from '@/services/promotions/PromotionService';

export async function GET(request: NextRequest, { params }: { params: { promotionId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const promotion = await PromotionService.get(session.organizationId, params.promotionId);
    return NextResponse.json({ promotion });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { promotionId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const body = await request.json();
    const input = updatePromotionSchema.parse(body);
    const promotion = await PromotionService.update(session.organizationId, params.promotionId, input, session.userId);
    return NextResponse.json({ promotion });
  } catch (error) {
    return toErrorResponse(error);
  }
}
