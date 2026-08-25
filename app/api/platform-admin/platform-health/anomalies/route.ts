import { NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { AnomalyDetectionService } from '@/services/platform-analytics/AnomalyDetectionService';

// Master spec §72's anomaly detection — request-triggered (see
// AnomalyDetectionService's header for why: no background scheduler
// exists in this codebase). Also exposed via the cron route below for an
// external scheduler.
export async function POST() {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'technical', { requireWrite: true });
    const results = await AnomalyDetectionService.runDailySweep();
    return NextResponse.json({ results });
  } catch (error) {
    return toErrorResponse(error);
  }
}
