import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { CAMPAIGN_STATUSES } from '@/lib/validation/promotion';
import { PromotionCampaignService } from '@/services/promotions/PromotionCampaignService';

const updateCampaignStatusSchema = z.object({ status: z.enum(CAMPAIGN_STATUSES) });

/** DRAFT/SCHEDULED/ACTIVE/PAUSED/COMPLETED/CANCELLED (spec § 28). For actually resolving+recording the audience and marking a campaign sent, see POST .../send instead — status alone never materializes CampaignAudience rows. */
export async function PATCH(request: NextRequest, { params }: { params: { campaignId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const body = await request.json();
    const input = updateCampaignStatusSchema.parse(body);
    const campaign = await PromotionCampaignService.updateStatus(session.organizationId, params.campaignId, input.status, session.userId);
    return NextResponse.json({ campaign });
  } catch (error) {
    return toErrorResponse(error);
  }
}
