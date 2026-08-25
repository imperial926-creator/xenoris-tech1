import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { CustomerReservationService } from '@/services/customer/CustomerReservationService';
import { toErrorResponse } from '@/lib/utils/api-error';

// Single-reservation detail — scoped to the requesting diner inside
// CustomerReservationService.get, so requesting another customer's
// reservationId 404s exactly like it not existing, never a 403 that would
// confirm the id is real (same "don't leak existence" posture as the rest
// of this codebase's ownership checks).
export async function GET(
  request: NextRequest,
  { params }: { params: { restaurantId: string; reservationId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const reservation = await CustomerReservationService.get(
      params.restaurantId,
      session.customerAccountId,
      params.reservationId,
    );
    return NextResponse.json({ reservation }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
