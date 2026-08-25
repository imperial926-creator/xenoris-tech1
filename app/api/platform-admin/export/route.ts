import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { exportRequestSchema, platformDateRangeQuerySchema } from '@/lib/validation/platform-analytics';
import { resolvePlatformDateRange } from '@/lib/platform-analytics/date-range';
import { ReportQueryService, METRIC_CATALOG, type MetricKey } from '@/services/platform-analytics/ReportQueryService';
import { ExportService } from '@/services/platform-analytics/ExportService';

// Master spec's export requirement — permission-controlled and audited
// (ExportService.logExport is called before data is returned). Only CSV
// and JSON are real; see ExportService's header for why Excel/PDF are not.
export async function POST(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'analytics', { requireWrite: true });
    const body = exportRequestSchema.parse(await request.json());

    if (!(body.reportType in METRIC_CATALOG)) {
      return NextResponse.json({ error: `Unknown reportType "${body.reportType}".` }, { status: 422 });
    }
    const query = platformDateRangeQuerySchema.parse({ preset: 'last_30_days' });
    const range = resolvePlatformDateRange(query.preset, new Date());
    const result = await ReportQueryService.run(body.reportType as MetricKey, range);
    const rows = Array.isArray(result) ? result : [result];

    const exported = await ExportService.export({
      platformAdminId: session.platformAdminId,
      reportType: body.reportType,
      format: body.format,
      rows: rows as Array<Record<string, unknown>>,
      filters: body.filters,
    });

    return new NextResponse(exported.content, {
      headers: {
        'Content-Type': exported.contentType,
        'Content-Disposition': `attachment; filename="${body.reportType}.${body.format}"`,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
