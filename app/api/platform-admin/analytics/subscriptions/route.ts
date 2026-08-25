import { NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { SubscriptionAnalyticsService } from '@/services/platform-billing/SubscriptionAnalyticsService';

export async function GET() {
  try {
    await requirePlatformAdmin(await getPlatformAdminSession());
    const analytics = await SubscriptionAnalyticsService.subscriptionAnalytics();
    return NextResponse.json({ analytics });
  } catch (error) {
    return toErrorResponse(error);
  }
}
