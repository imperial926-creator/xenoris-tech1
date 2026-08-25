import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createSubscriptionPlanSchema } from '@/lib/validation/platform-billing';
import { SubscriptionPlanService } from '@/services/platform-billing/SubscriptionPlanService';

export async function GET() {
  try {
    await requirePlatformAdmin(await getPlatformAdminSession());
    const plans = await SubscriptionPlanService.listAll();
    return NextResponse.json({ plans });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    const body = createSubscriptionPlanSchema.parse(await request.json());
    const plan = await SubscriptionPlanService.create(body, session.platformAdminId);
    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
