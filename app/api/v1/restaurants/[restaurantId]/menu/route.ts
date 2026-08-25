import { NextRequest, NextResponse } from 'next/server';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { toErrorResponse } from '@/lib/utils/api-error';

// Same public/unauthenticated shape as the parent route — see its header.
export async function GET(
  _request: NextRequest,
  { params }: { params: { restaurantId: string } },
) {
  try {
    const restaurant = await RestaurantDirectoryService.getByPublicCode(params.restaurantId);
    const categories = await RestaurantDirectoryService.getPublicMenu(restaurant.id);
    return NextResponse.json({ categories }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
