import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createSavedReportSchema } from '@/lib/validation/platform-analytics';
import { ReportQueryService, METRIC_CATALOG, type MetricKey } from '@/services/platform-analytics/ReportQueryService';

// Master spec's Custom Report Builder (ADMIN → CUSTOM REPORTS) — see
// ReportQueryService's header for why this is a bounded metric catalog,
// not an arbitrary query engine.
export async function GET() {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'analytics');
    const reports = await ReportQueryService.listSavedReports();
    return NextResponse.json({ reports });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'analytics', { requireWrite: true });
    const body = createSavedReportSchema.parse(await request.json());
    if (!(body.config.metric in METRIC_CATALOG)) {
      return NextResponse.json({ error: `Unknown metric "${body.config.metric}".` }, { status: 422 });
    }
    const report = await ReportQueryService.createSavedReport({
      name: body.name,
      scheduleCron: body.scheduleCron,
      createdByAdminId: session.platformAdminId,
      config: { ...body.config, metric: body.config.metric as MetricKey },
    });
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
