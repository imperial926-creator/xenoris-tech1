import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { analyticsQuerySchema } from '@/lib/validation/analytics';
import { AnalyticsService } from '@/services/analytics/AnalyticsService';

/** Master spec Phase 12's Inventory analytics — waste cost by ingredient, purchase spend, recipe-consumption food cost, and low/critical stock items. */
export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ANALYTICS_VIEW);
    const { searchParams } = new URL(request.url);
    const query = analyticsQuerySchema.parse({
      preset: searchParams.get('preset') ?? undefined,
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
      branchId: searchParams.get('branchId') ?? undefined,
    });
    const inventory = await AnalyticsService.getInventoryAnalytics(session.organizationId, query);
    return NextResponse.json({ inventory });
  } catch (error) {
    return toErrorResponse(error);
  }
}
