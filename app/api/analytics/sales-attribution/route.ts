import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { analyticsQuerySchema } from '@/lib/validation/analytics';
import { PromotionAnalyticsService } from '@/services/promotions/PromotionAnalyticsService';

/**
 * CAPP Phase 11 — spec § 56 "Financial Integration" / § 62's phased-plan
 * "Sales attribution" item. Gross/net sales reuse
 * `AccountingService.recordOrderRevenue`'s own revenue formula (see
 * PromotionAnalyticsService.getSalesAttribution's comment) rather than
 * defining a second one; promotion-attributed sales is the one figure this
 * report adds that the base platform's own Revenue dashboard doesn't have.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ANALYTICS_VIEW);
    const { searchParams } = new URL(request.url);
    const query = analyticsQuerySchema.parse({
      preset: searchParams.get('preset') ?? undefined,
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
    });
    const attribution = await PromotionAnalyticsService.getSalesAttribution(session.organizationId, query);
    return NextResponse.json({ attribution });
  } catch (error) {
    return toErrorResponse(error);
  }
}
