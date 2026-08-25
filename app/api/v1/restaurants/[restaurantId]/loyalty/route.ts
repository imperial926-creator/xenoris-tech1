import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { LoyaltyService } from '@/services/loyalty/LoyaltyService';
import { toErrorResponse } from '@/lib/utils/api-error';

/** CAPP Phase 10 — spec § 37 / § 45 Home Screen "Loyalty status." Bearer-auth gated, same personal-data pattern as every other customer-facing account route. */
export async function GET(request: NextRequest, { params }: { params: { restaurantId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(params.restaurantId);
    const loyalty = await LoyaltyService.getSummary(organizationId, session.customerAccountId);
    return NextResponse.json({ loyalty }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
