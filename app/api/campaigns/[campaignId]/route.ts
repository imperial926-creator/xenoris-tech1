import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateCampaignSchema } from '@/lib/validation/promotion';
import { PromotionCampaignService } from '@/services/promotions/PromotionCampaignService';

export async function GET(request: NextRequest, { params }: { params: { campaignId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const campaign = await PromotionCampaignService.get(session.organizationId, params.campaignId);
    return NextResponse.json({ campaign });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { campaignId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const body = await request.json();
    const input = updateCampaignSchema.parse(body);
    const campaign = await PromotionCampaignService.update(session.organizationId, params.campaignId, input, session.userId);
    return NextResponse.json({ campaign });
  } catch (error) {
    return toErrorResponse(error);
  }
}
