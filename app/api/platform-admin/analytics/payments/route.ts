import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { SubscriptionAnalyticsService } from '@/services/platform-billing/SubscriptionAnalyticsService';

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(await getPlatformAdminSession());
    const q = request.nextUrl.searchParams;
    const from = q.get('from');
    const to = q.get('to');
    const analytics = await SubscriptionAnalyticsService.paymentAnalytics(
      from && to ? { from: new Date(from), to: new Date(to) } : undefined,
    );
    return NextResponse.json({ analytics });
  } catch (error) {
    return toErrorResponse(error);
  }
}
