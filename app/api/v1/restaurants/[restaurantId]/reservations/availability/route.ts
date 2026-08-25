import { NextRequest, NextResponse } from 'next/server';
import { customerAvailabilityQuerySchema } from '@/lib/validation/customer-reservation';
import { CustomerReservationService } from '@/services/customer/CustomerReservationService';
import { toErrorResponse } from '@/lib/utils/api-error';

// Unauthenticated, same as menu/route.ts — a diner must be able to see
// whether a time slot has room before they've registered (spec § 10's flow
// starts with "System checks live availability", not "log in first").
export async function GET(
  request: NextRequest,
  { params }: { params: { restaurantId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const query = customerAvailabilityQuerySchema.parse({
      startAt: searchParams.get('startAt') ?? '',
      durationMinutes: searchParams.get('durationMinutes') ?? undefined,
      guestCount: searchParams.get('guestCount') ?? undefined,
    });
    const result = await CustomerReservationService.checkAvailability(params.restaurantId, query);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
