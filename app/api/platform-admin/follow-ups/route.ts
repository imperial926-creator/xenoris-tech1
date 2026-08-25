import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { FollowUpService } from '@/services/platform-analytics/FollowUpService';
import type { TaskType } from '@/services/platform-billing/ActionCenterService';

// Master Data Analytics spec's Follow-Up Management (ADMIN → FOLLOW-UPS) —
// a filtered view over the Action Center; see FollowUpService's header.
export async function GET(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'action_center');
    const q = request.nextUrl.searchParams;
    const tasks = await FollowUpService.list({
      type: (q.get('type') as TaskType | null) ?? undefined,
      assignedToAdminId: q.get('assignedToAdminId') ?? undefined,
    });
    return NextResponse.json({ tasks });
  } catch (error) {
    return toErrorResponse(error);
  }
}
