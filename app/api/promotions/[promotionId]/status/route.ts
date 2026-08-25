import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updatePromotionStatusSchema } from '@/lib/validation/promotion';
import { PromotionService } from '@/services/promotions/PromotionService';

/** DRAFT/SCHEDULED/ACTIVE/PAUSED/ENDED/CANCELLED transitions (spec § 28) — see PromotionService's ALLOWED_TRANSITIONS for the exact graph. */
export async function PATCH(request: NextRequest, { params }: { params: { promotionId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const body = await request.json();
    const input = updatePromotionStatusSchema.parse(body);
    const promotion = await PromotionService.updateStatus(session.organizationId, params.promotionId, input.status, session.userId);
    return NextResponse.json({ promotion });
  } catch (error) {
    return toErrorResponse(error);
  }
}
