import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { recordDepositSchema } from '@/lib/validation/reservation';
import { ReservationService } from '@/services/reservations/ReservationService';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string; reservationId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.RESERVATION_MANAGE);
    const body = await request.json();
    const input = recordDepositSchema.parse(body);
    const reservation = await ReservationService.recordDeposit(
      session.organizationId,
      params.id,
      params.reservationId,
      input,
      session.userId,
    );
    return NextResponse.json({ reservation });
  } catch (error) {
    return toErrorResponse(error);
  }
}
