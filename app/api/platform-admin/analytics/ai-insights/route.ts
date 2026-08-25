import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { platformDateRangeQuerySchema } from '@/lib/validation/platform-analytics';
import { resolvePlatformDateRange } from '@/lib/platform-analytics/date-range';
import { AIAnalyticsAssistantService } from '@/services/platform-analytics/AIAnalyticsAssistantService';

// Master spec §70-71's "AI Business Analyst" — see that service's header
// for the FACT/INTERPRETATION/RECOMMENDATION safety boundary.
export async function GET(request: NextRequest) {
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
    const result = await AIAnalyticsAssistantService.generateInsights(range);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
