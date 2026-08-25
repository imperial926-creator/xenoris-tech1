import { NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { ActionCenterService } from '@/services/platform-billing/ActionCenterService';

// Master spec §59's "every action must link directly to the relevant
// source" — task detail with its notes and linked entities.
export async function GET(_request: Request, { params }: { params: { taskId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'action_center');
    const task = await ActionCenterService.get(params.taskId);
    return NextResponse.json({ task });
  } catch (error) {
    return toErrorResponse(error);
  }
}
