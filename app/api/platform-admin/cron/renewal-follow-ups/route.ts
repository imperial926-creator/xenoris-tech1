import { NextRequest, NextResponse } from 'next/server';
import { FollowUpService } from '@/services/platform-analytics/FollowUpService';
import { PlatformAnalyticsConfigService } from '@/services/platform-analytics/PlatformAnalyticsConfigService';
import { log } from '@/lib/monitoring/logger';

// Same external-scheduler pattern as
// /api/platform-admin/cron/subscription-retries — see that route's header.
export async function POST(request: NextRequest) {
  const expected = process.env.PLATFORM_CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    const config = await PlatformAnalyticsConfigService.get();
    const reminderDays = config.renewalReminderDays as number[];
    const result = await FollowUpService.generateRenewalFollowUps(reminderDays);
    return NextResponse.json(result);
  } catch (error) {
    log.error('Renewal follow-up generation cron run failed', error);
    return NextResponse.json({ error: 'Follow-up generation failed.' }, { status: 500 });
  }
}
