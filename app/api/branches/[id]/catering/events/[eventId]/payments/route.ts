import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { recordCateringPaymentSchema } from '@/lib/validation/catering';
import { CateringService } from '@/services/catering/CateringService';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; eventId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const body = await request.json();
    const input = recordCateringPaymentSchema.parse(body);
    const event = await CateringService.recordPayment(
      session.organizationId,
      params.id,
      params.eventId,
      input,
      session.userId,
    );
    return NextResponse.json({ event });
  } catch (error) {
    return toErrorResponse(error);
  }
}
