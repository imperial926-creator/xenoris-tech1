import { NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { EngagementScoreService } from '@/services/platform-analytics/EngagementScoreService';
import { RestaurantLifecycleService } from '@/services/platform-analytics/RestaurantLifecycleService';

export async function GET(_request: Request, { params }: { params: { organizationId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'analytics');
    const [current, trend, lifecycleHistory] = await Promise.all([
      EngagementScoreService.computeForOrganization(params.organizationId),
      EngagementScoreService.trend(params.organizationId),
      RestaurantLifecycleService.history(params.organizationId),
    ]);
    return NextResponse.json({ current, trend, lifecycleHistory });
  } catch (error) {
    return toErrorResponse(error);
  }
}
