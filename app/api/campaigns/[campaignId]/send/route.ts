import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { PromotionCampaignService } from '@/services/promotions/PromotionCampaignService';

/** Resolves+materializes the audience, marks the campaign ACTIVE/sent, and writes every eligible member's notification-center entry + queued deliveries (CAPP Phase 9) — see PromotionCampaignService.send's header comment for exactly what still doesn't happen synchronously here (the actual PUSH/EMAIL/SMS provider call — see POST /api/campaigns/dispatch). */
export async function POST(request: NextRequest, { params }: { params: { campaignId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const result = await PromotionCampaignService.send(session.organizationId, params.campaignId, session.userId);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
