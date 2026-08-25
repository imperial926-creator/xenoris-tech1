import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import {
  customerCreateReservationSchema,
  customerListReservationsQuerySchema,
} from '@/lib/validation/customer-reservation';
import { CustomerReservationService } from '@/services/customer/CustomerReservationService';
import { toErrorResponse } from '@/lib/utils/api-error';

/**
 * GET  — the diner's own reservation history at this restaurant (spec § 1
 *        item 19). Requires a valid customer session, same bearer-auth
 *        pattern as auth/logout-all/route.ts.
 * POST — books a dine-in reservation (spec § 10). Auto-assigns table(s);
 *        see CustomerReservationService for why this never accepts a
 *        `tableIds` field the way the staff route does.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { restaurantId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const { searchParams } = new URL(request.url);
    const query = customerListReservationsQuerySchema.parse({
      upcomingOnly: searchParams.get('upcomingOnly') ?? undefined,
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const reservations = await CustomerReservationService.list(
      params.restaurantId,
      session.customerAccountId,
      query,
    );
    return NextResponse.json({ reservations }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { restaurantId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const body = await request.json();
    const input = customerCreateReservationSchema.parse(body);
    const reservation = await CustomerReservationService.createReservation(
      params.restaurantId,
      session.customerAccountId,
      input,
    );
    return NextResponse.json({ reservation }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
