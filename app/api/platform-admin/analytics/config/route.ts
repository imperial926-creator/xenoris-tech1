import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updatePlatformAnalyticsConfigSchema } from '@/lib/validation/platform-analytics';
import { PlatformAnalyticsConfigService } from '@/services/platform-analytics/PlatformAnalyticsConfigService';

// Admin-configurable engagement weights, anomaly threshold, complaint SLA,
// renewal reminder schedule, inactivity threshold — every "must be
// configurable" number the master spec calls out.
export async function GET() {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'analytics');
    const config = await PlatformAnalyticsConfigService.get();
    return NextResponse.json({ config });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'analytics', { requireWrite: true });
    const body = updatePlatformAnalyticsConfigSchema.parse(await request.json());
    const config = await PlatformAnalyticsConfigService.update(body, session.platformAdminId);
    return NextResponse.json({ config });
  } catch (error) {
    return toErrorResponse(error);
  }
}
