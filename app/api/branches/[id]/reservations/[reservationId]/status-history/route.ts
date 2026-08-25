import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { ReservationService } from '@/services/reservations/ReservationService';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; reservationId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.RESERVATION_VIEW);
    const history = await ReservationService.getStatusHistory(
      session.organizationId,
      params.id,
      params.reservationId,
    );
    return NextResponse.json({ history });
  } catch (error) {
    return toErrorResponse(error);
  }
}
