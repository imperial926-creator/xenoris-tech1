import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { ActionCenterService } from '@/services/platform-billing/ActionCenterService';

// Master spec §63's configurable escalation.
export async function POST(request: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'action_center', { requireWrite: true });
    const body = await request.json().catch(() => ({}));
    const task = await ActionCenterService.escalate(params.taskId, session.platformAdminId, body.reason);
    return NextResponse.json({ task });
  } catch (error) {
    return toErrorResponse(error);
  }
}
