import { NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { getSmsProvider } from '@/lib/notifications/SmsProvider';
import { PlatformBillingConfigService } from '@/services/platform-billing/PlatformBillingConfigService';

// Master spec §28: "During SaaS Owner setup, provide [SEND TEST SMS] ...
// verify that the test message was received before production SMS
// notifications are activated."
export async function POST() {
  try {
    await requirePlatformAdmin(await getPlatformAdminSession());
    const config = await PlatformBillingConfigService.get();
    if (!config.smsNotificationNumber) {
      return NextResponse.json(
        { error: 'Set a notification number in Billing Configuration before sending a test SMS.' },
        { status: 409 },
      );
    }
    const result = await getSmsProvider().send({
      to: config.smsNotificationNumber,
      body: 'Restaurant SaaS billing notification test successful.',
    });
    return NextResponse.json({ result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
