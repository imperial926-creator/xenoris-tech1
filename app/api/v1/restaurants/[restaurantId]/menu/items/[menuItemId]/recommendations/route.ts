import { NextRequest, NextResponse } from 'next/server';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { toErrorResponse } from '@/lib/utils/api-error';

/** CAPP Phase 10 — spec § 39 "Upselling." Public/unauthenticated, same as the parent `menu` route — a diner should see recommendations while browsing before signing in. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { restaurantId: string; menuItemId: string } },
) {
  try {
    const restaurant = await RestaurantDirectoryService.getByPublicCode(params.restaurantId);
    const recommendations = await RestaurantDirectoryService.getMenuItemRecommendations(restaurant.id, params.menuItemId);
    return NextResponse.json({ recommendations }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
