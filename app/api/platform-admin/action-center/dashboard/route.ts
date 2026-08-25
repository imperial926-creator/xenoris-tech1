import { NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { ActionCenterService } from '@/services/platform-billing/ActionCenterService';

// Master spec §2/§40/§58's Action Center dashboard header + daily briefing.
export async function GET() {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'action_center');
    const briefing = await ActionCenterService.dailyBriefing();
    return NextResponse.json(briefing);
  } catch (error) {
    return toErrorResponse(error);
  }
}
