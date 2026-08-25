import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { platformDateRangeQuerySchema } from '@/lib/validation/platform-analytics';
import { resolvePlatformDateRange } from '@/lib/platform-analytics/date-range';
import { ReportQueryService } from '@/services/platform-analytics/ReportQueryService';

export async function POST(request: NextRequest, { params }: { params: { reportId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'analytics');
    const q = request.nextUrl.searchParams;
    const query = platformDateRangeQuerySchema.parse({
      preset: q.get('preset') ?? undefined,
      customStart: q.get('customStart') ?? undefined,
      customEnd: q.get('customEnd') ?? undefined,
    });
    const range = resolvePlatformDateRange(query.preset, new Date(), query.customStart, query.customEnd);
    const result = await ReportQueryService.runSavedReport(params.reportId, range);
    return NextResponse.json({ result, range });
  } catch (error) {
    return toErrorResponse(error);
  }
}
