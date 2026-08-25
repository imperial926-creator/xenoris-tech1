import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { PromotionCampaignService } from '@/services/promotions/PromotionCampaignService';

/** Dry-run audience resolution (spec § 19 "the system should generate the eligible audience automatically") — no rows written, no status change. See PromotionCampaignService.previewAudience. */
export async function GET(request: NextRequest, { params }: { params: { campaignId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const preview = await PromotionCampaignService.previewAudience(session.organizationId, params.campaignId);
    return NextResponse.json(preview);
  } catch (error) {
    return toErrorResponse(error);
  }
}
