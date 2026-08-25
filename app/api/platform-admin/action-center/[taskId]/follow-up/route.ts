import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { scheduleFollowUpSchema } from '@/lib/validation/platform-analytics';
import { ActionCenterService } from '@/services/platform-billing/ActionCenterService';

// Master spec §33/§34's follow-up scheduling with method.
export async function POST(request: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'action_center', { requireWrite: true });
    const body = scheduleFollowUpSchema.parse(await request.json());
    const task = await ActionCenterService.scheduleFollowUp(params.taskId, body.nextFollowUpAt, body.followUpMethod);
    return NextResponse.json({ task });
  } catch (error) {
    return toErrorResponse(error);
  }
}
