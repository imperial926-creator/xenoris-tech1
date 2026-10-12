import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { CateringService } from '@/services/catering/CateringService';

export async function GET(
  _request: NextRequest,
  { params }: {
    params: Promise<{ id: string; eventId: string }>;
  },
) {
  try {
    const { id, eventId } = await params;

    const session = await requirePermission(
      await getSession(),
      PERMISSIONS.CATERING_MANAGE,
    );

    const event = await CateringService.getEvent(
      session.organizationId,
      id,
      eventId,
    );

    return NextResponse.json({ event });
  } catch (error) {
    return toErrorResponse(error);
  }
}