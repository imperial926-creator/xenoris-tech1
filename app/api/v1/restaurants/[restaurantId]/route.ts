import { NextRequest, NextResponse } from 'next/server';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { toErrorResponse } from '@/lib/utils/api-error';

// `restaurantId` here is the PUBLIC code (e.g. "RST-000042"), never the
// internal cuid — see docs/customer-app/architecture.md § 3. Unauthenticated
// on purpose: a diner must be able to view a restaurant's public profile
// before registering or logging in.
export async function GET(
  _request: NextRequest,
  { params }: { params: { restaurantId: string } },
) {
  try {
    const restaurant = await RestaurantDirectoryService.getByPublicCode(params.restaurantId);
    return NextResponse.json({ restaurant }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
