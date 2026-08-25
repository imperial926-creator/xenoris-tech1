import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { EngagementScoreService } from '@/services/platform-analytics/EngagementScoreService';

// Master spec's Restaurant Engagement Score — decision support only, see
// EngagementScoreService's header: nothing here auto-cancels an account.
export async function GET() {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'analytics');
    const atRisk = await EngagementScoreService.atRiskRestaurants();
    return NextResponse.json({ atRiskRestaurants: atRisk });
  } catch (error) {
    return toErrorResponse(error);
  }
}

const bodySchema = z.object({ organizationId: z.string().min(1) });

// Computes (and snapshots) a fresh engagement score for one restaurant —
// request-triggered, since this codebase has no background scheduler.
export async function POST(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'analytics', { requireWrite: true });
    const body = bodySchema.parse(await request.json());
    const snapshot = await EngagementScoreService.snapshotForOrganization(body.organizationId);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return toErrorResponse(error);
  }
}
