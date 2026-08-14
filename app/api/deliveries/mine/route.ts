import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { DeliveryService } from '@/services/delivery/DeliveryService';

/**
 * The driver interface (master spec §19): "Drivers must only see deliveries
 * they are authorized to access." Not branch-nested — a driver's own
 * profile already fixes which branch they belong to, and every filter here
 * comes from the session, never from a client-supplied ID, so there is no
 * way to request another driver's queue.
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.DELIVERY_MANAGE);
    const deliveries = await DeliveryService.myDeliveries(session.organizationId, session.userId);
    return NextResponse.json({ deliveries });
  } catch (error) {
    return toErrorResponse(error);
  }
}
