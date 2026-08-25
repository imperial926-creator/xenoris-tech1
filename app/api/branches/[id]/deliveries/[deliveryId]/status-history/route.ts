import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { DeliveryService } from '@/services/delivery/DeliveryService';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; deliveryId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.DELIVERY_MANAGE);
    const history = await DeliveryService.getStatusHistory(session.organizationId, params.id, params.deliveryId);
    return NextResponse.json({ history });
  } catch (error) {
    return toErrorResponse(error);
  }
}
