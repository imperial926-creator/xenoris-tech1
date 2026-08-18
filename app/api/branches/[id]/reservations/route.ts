import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createReservationSchema, listReservationsQuerySchema } from '@/lib/validation/reservation';
import { ReservationService } from '@/services/reservations/ReservationService';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.RESERVATION_VIEW);
    const { searchParams } = new URL(request.url);
    const query = listReservationsQuerySchema.parse({
      status: searchParams.get('status') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const reservations = await ReservationService.list(session.organizationId, params.id, query);
    return NextResponse.json({ reservations });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.RESERVATION_MANAGE);
    const body = await request.json();
    const input = createReservationSchema.parse(body);
    const reservation = await ReservationService.createReservation(
      session.organizationId,
      params.id,
      input,
      session.userId,
    );
    return NextResponse.json({ reservation }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
