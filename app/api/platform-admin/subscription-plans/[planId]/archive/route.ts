import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { SubscriptionPlanService } from '@/services/platform-billing/SubscriptionPlanService';

export async function POST(_request: NextRequest, { params }: { params: { planId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    const plan = await SubscriptionPlanService.archive(params.planId, session.platformAdminId);
    return NextResponse.json({ plan });
  } catch (error) {
    return toErrorResponse(error);
  }
}
