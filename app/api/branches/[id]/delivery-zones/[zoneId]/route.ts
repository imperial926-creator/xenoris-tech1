import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateDeliveryZoneSchema } from '@/lib/validation/delivery';
import { DeliveryZoneService } from '@/services/delivery/DeliveryZoneService';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; zoneId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.DELIVERY_MANAGE);
    const zone = await DeliveryZoneService.get(session.organizationId, params.id, params.zoneId);
    return NextResponse.json({ zone });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; zoneId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.DELIVERY_MANAGE);
    const body = await request.json();
    const input = updateDeliveryZoneSchema.parse(body);
    const zone = await DeliveryZoneService.update(session.organizationId, params.id, params.zoneId, input, session.userId);
    return NextResponse.json({ zone });
  } catch (error) {
    return toErrorResponse(error);
  }
}
