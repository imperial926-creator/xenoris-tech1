import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { PromotionAnalyticsService } from '@/services/promotions/PromotionAnalyticsService';

/** CAPP Phase 11 — spec § 30 "Promotion ROI" and § 29 "Promotion Analytics," at the promotion level (a promotion can be redeemed via more than one campaign send, or a promo code entered with no campaign at all — see PromotionAnalyticsService's header for why campaign- and promotion-level numbers are computed separately). */
export async function GET(request: NextRequest, { params }: { params: { promotionId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const analytics = await PromotionAnalyticsService.getPromotionAnalytics(session.organizationId, params.promotionId);
    return NextResponse.json({ analytics });
  } catch (error) {
    return toErrorResponse(error);
  }
}
