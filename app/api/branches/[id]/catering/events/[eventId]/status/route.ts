
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateCateringEventStatusSchema } from '@/lib/validation/catering';
import { CateringService } from '@/services/catering/CateringService';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  try {
    const { id, eventId } = await params;
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const body = await request.json();
    const input = updateCateringEventStatusSchema.parse(body);
    const event = await CateringService.updateEventStatus(
      session.organizationId,
      id,
      eventId,
      input,
      session.userId,
    );
    return NextResponse.json({ event });
  } catch (error) {
    return toErrorResponse(error);
  }
}
