import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateDeliveryStatusSchema } from '@/lib/validation/delivery';
import { DeliveryService } from '@/services/delivery/DeliveryService';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; deliveryId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.DELIVERY_MANAGE);
    const body = await request.json();
    const input = updateDeliveryStatusSchema.parse(body);
    const delivery = await DeliveryService.updateStatus(
      session.organizationId,
      params.id,
      params.deliveryId,
      input,
      session.userId,
    );
    return NextResponse.json({ delivery });
  } catch (error) {
    return toErrorResponse(error);
  }
}
