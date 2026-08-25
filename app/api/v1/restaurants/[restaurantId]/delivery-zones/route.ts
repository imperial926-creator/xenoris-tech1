import { NextRequest, NextResponse } from 'next/server';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { DeliveryZoneService } from '@/services/delivery/DeliveryZoneService';
import { toErrorResponse } from '@/lib/utils/api-error';

/**
 * CAPP Phase 5 — the diner-facing zone picker (spec § 12). Unauthenticated,
 * same as menu/route.ts and reservations/availability/route.ts: a diner
 * needs to see whether this restaurant even delivers to an area before
 * they've registered, same "browse before you log in" posture as the rest
 * of the storefront. Only active zones (DeliveryZoneService.listActive) —
 * never the staff-only full list, which includes inactive/retired zones.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { restaurantId: string } },
) {
  try {
    const { organizationId, branchId } = await RestaurantDirectoryService.resolveStorefront(params.restaurantId);
    const zones = await DeliveryZoneService.listActive(organizationId, branchId);
    return NextResponse.json({ zones }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
