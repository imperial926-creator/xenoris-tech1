import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateSubscriptionPlanSchema } from '@/lib/validation/platform-billing';
import { SubscriptionPlanService } from '@/services/platform-billing/SubscriptionPlanService';

export async function PUT(request: NextRequest, { params }: { params: { planId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    const body = updateSubscriptionPlanSchema.parse(await request.json());
    const plan = await SubscriptionPlanService.update(params.planId, body, session.platformAdminId);
    return NextResponse.json({ plan });
  } catch (error) {
    return toErrorResponse(error);
  }
}
