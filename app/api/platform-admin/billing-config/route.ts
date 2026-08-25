import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updatePlatformBillingConfigSchema } from '@/lib/validation/platform-billing';
import { PlatformBillingConfigService } from '@/services/platform-billing/PlatformBillingConfigService';

// Master spec §52-53: "SaaS Owner Billing Configuration" / "SaaS Owner
// Settlement Configuration" screens. Never returns a full bank account
// number or any secret — see PlatformBillingConfigService's header.
export async function GET() {
  try {
    await requirePlatformAdmin(await getPlatformAdminSession());
    const config = await PlatformBillingConfigService.get();
    return NextResponse.json({ config });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    const body = updatePlatformBillingConfigSchema.parse(await request.json());
    const config = await PlatformBillingConfigService.update(body, session.platformAdminId);
    return NextResponse.json({ config });
  } catch (error) {
    return toErrorResponse(error);
  }
}
