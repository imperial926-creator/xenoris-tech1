import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createCampaignSchema, listCampaignsQuerySchema } from '@/lib/validation/promotion';
import { PromotionCampaignService } from '@/services/promotions/PromotionCampaignService';

export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const { searchParams } = new URL(request.url);
    const query = listCampaignsQuerySchema.parse({
      status: searchParams.get('status') ?? undefined,
      promotionId: searchParams.get('promotionId') ?? undefined,
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const campaigns = await PromotionCampaignService.list(session.organizationId, query);
    return NextResponse.json({ campaigns });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const body = await request.json();
    const input = createCampaignSchema.parse(body);
    const campaign = await PromotionCampaignService.create(session.organizationId, input, session.userId);
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
