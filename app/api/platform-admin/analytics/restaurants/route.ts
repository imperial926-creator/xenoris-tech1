import { NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { RestaurantLifecycleService } from '@/services/platform-analytics/RestaurantLifecycleService';
import { EngagementScoreService } from '@/services/platform-analytics/EngagementScoreService';

// Master spec's restaurant lifecycle funnel + engagement/at-risk view.
// Rankings here are explicitly for success analysis / support / product
// improvement — never for punitive use (spec's own instruction).
export async function GET() {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'analytics');
    const [funnel, atRisk] = await Promise.all([
      RestaurantLifecycleService.funnelSnapshot(),
      EngagementScoreService.atRiskRestaurants(),
    ]);
    return NextResponse.json({ lifecycleFunnel: funnel, atRiskRestaurants: atRisk });
  } catch (error) {
    return toErrorResponse(error);
  }
}
