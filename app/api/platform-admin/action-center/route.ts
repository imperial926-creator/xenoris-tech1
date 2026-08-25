import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { actionCenterTaskFilterSchema } from '@/lib/validation/platform-analytics';
import { ActionCenterService, type ActionCenterTaskStatusValue } from '@/services/platform-billing/ActionCenterService';

// Phase 18: the unified Action Center list, now filterable by priority,
// assignee, organization, and overdue status per the Data Analytics +
// Action Center master spec §44. `resource: 'action_center'` is
// intentionally accessible to every role (see lib/platform-admin/rbac.ts) —
// every admin role has SOME reason to see their own queue.
export async function GET(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'action_center');
    const q = request.nextUrl.searchParams;
    const filters = actionCenterTaskFilterSchema.parse({
      status: q.get('status') ?? undefined,
      priority: q.get('priority') ?? undefined,
      type: q.get('type') ?? undefined,
      assignedToAdminId: q.get('assignedToAdminId') ?? undefined,
      organizationId: q.get('organizationId') ?? undefined,
      overdue: q.get('overdue') ?? undefined,
      limit: q.get('limit') ?? undefined,
    });
    const tasks = await ActionCenterService.list({
      ...filters,
      status: filters.status as ActionCenterTaskStatusValue | undefined,
    });
    return NextResponse.json({ tasks });
  } catch (error) {
    return toErrorResponse(error);
  }
}
