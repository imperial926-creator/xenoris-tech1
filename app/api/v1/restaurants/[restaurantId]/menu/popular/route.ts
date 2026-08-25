import { NextRequest, NextResponse } from 'next/server';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { toErrorResponse } from '@/lib/utils/api-error';

/** CAPP Phase 10 — spec § 45 Home Screen "Popular products." Public/unauthenticated, same as the parent `menu` route. Computed from real order history — see RestaurantDirectoryService.getPopularItems's own header. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { restaurantId: string } },
) {
  try {
    const restaurant = await RestaurantDirectoryService.getByPublicCode(params.restaurantId);
    const items = await RestaurantDirectoryService.getPopularItems(restaurant.id);
    return NextResponse.json({ items }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
