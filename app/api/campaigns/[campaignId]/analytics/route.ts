import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { PromotionAnalyticsService } from '@/services/promotions/PromotionAnalyticsService';

/** CAPP Phase 11 — spec § 55 "Campaign Analytics" / the master spec's own `GET /api/v1/campaigns/:campaignId/analytics`, moved to this build's established staff-route prefix (`/api/campaigns/**`, not `/v1`) — same convention every prior CAPP phase's staff surface has used since Phase 8. */
export async function GET(request: NextRequest, { params }: { params: { campaignId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const analytics = await PromotionAnalyticsService.getCampaignAnalytics(session.organizationId, params.campaignId);
    return NextResponse.json({ analytics });
  } catch (error) {
    return toErrorResponse(error);
  }
}
