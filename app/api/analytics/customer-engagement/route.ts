import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { analyticsQuerySchema } from '@/lib/validation/analytics';
import { PromotionAnalyticsService } from '@/services/promotions/PromotionAnalyticsService';

/**
 * CAPP Phase 11 — spec § 57 "Analytics" / § 62's phased-plan "Customer
 * engagement" item, org-wide and date-ranged. Reuses `ANALYTICS_VIEW`
 * (Phase 12's owner-analytics permission) rather than `PROMOTION_MANAGE` —
 * this reports on the whole customer-app funnel (app opens, menu views,
 * order/reservation activity), not just promotions/campaigns, so it belongs
 * with the base platform's other owner-analytics dashboards
 * (`/api/analytics/**`), same reasoning `branchId` on the shared query
 * schema doesn't apply here (this app has no branch picker) but the rest of
 * the date-range preset shape still does.
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
    const engagement = await PromotionAnalyticsService.getCustomerEngagement(session.organizationId, query);
    return NextResponse.json({ engagement });
  } catch (error) {
    return toErrorResponse(error);
  }
}
