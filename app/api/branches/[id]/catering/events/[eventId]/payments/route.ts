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
    // Phase 15 hardening: same fix as the sibling orders/[orderId]/
    // payments route — kept additive (added {payment}, bumped to 201)
    // rather than replacing {event}, since CateringService.recordPayment's
    // return contract is relied on directly by several integration tests.
    const payment = event.payments.reduce((latest, p) => (p.createdAt > latest.createdAt ? p : latest));
    return NextResponse.json({ event, payment }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
