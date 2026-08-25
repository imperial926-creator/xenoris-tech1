import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { assignActionCenterTaskSchema } from '@/lib/validation/platform-analytics';
import { ActionCenterService } from '@/services/platform-billing/ActionCenterService';

// Master spec §30's "Assign / Reassign / Self-assign".
export async function POST(request: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'action_center', { requireWrite: true });
    const body = assignActionCenterTaskSchema.parse(await request.json());
    const task = await ActionCenterService.assign(params.taskId, body.assignedToAdminId, session.platformAdminId);
    return NextResponse.json({ task });
  } catch (error) {
    return toErrorResponse(error);
  }
}
