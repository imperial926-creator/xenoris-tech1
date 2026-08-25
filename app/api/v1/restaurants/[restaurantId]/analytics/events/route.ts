import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession } from '@/lib/customer-auth/guard';
import { logAnalyticsEventSchema } from '@/lib/validation/analytics-event';
import { CustomerAnalyticsService } from '@/services/customer/CustomerAnalyticsService';
import { toErrorResponse } from '@/lib/utils/api-error';

/**
 * CAPP Phase 11 — spec § 57 "Analytics." Deliberately optional-auth, not
 * `requireCustomerAuthenticated` like every other `/v1` route: App
 * opened/Restaurant viewed/Menu viewed/Promotion viewed can all fire before
 * a diner signs in (this app never gates browsing behind auth — see
 * `RestaurantDirectoryService`/`MenuScreen`'s own header comments), so
 * `getCustomerSession` is read directly and its `customerAccountId` passed
 * through as `null` rather than rejecting the request.
 */
export async function POST(request: NextRequest, { params }: { params: { restaurantId: string } }) {
  try {
    const session = await getCustomerSession(request);
    const body = await request.json();
    const input = logAnalyticsEventSchema.parse(body);
    const result = await CustomerAnalyticsService.logEvent(params.restaurantId, session?.customerAccountId ?? null, input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
