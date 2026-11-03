import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { availabilityQuerySchema } from '@/lib/validation/reservation';
import { ReservationService } from '@/services/reservations/ReservationService';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.RESERVATION_VIEW);
    const { searchParams } = new URL(request.url);
    const query = availabilityQuerySchema.parse({
      startAt: searchParams.get('startAt') ?? '',
      durationMinutes: searchParams.get('durationMinutes') ?? undefined,
      guestCount: searchParams.get('guestCount') ?? undefined,
    });
    const tables = await ReservationService.findAvailableTables(session.organizationId, params.id, query);
    return NextResponse.json({ tables });
  } catch (error) {
    return toErrorResponse(error);
  }
}
