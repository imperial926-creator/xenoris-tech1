import { NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { METRIC_CATALOG } from '@/services/platform-analytics/ReportQueryService';

export async function GET() {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'analytics');
    return NextResponse.json({ metrics: METRIC_CATALOG });
  } catch (error) {
    return toErrorResponse(error);
  }
}
