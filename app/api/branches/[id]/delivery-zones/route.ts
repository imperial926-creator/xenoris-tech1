import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createDeliveryZoneSchema } from '@/lib/validation/delivery';
import { DeliveryZoneService } from '@/services/delivery/DeliveryZoneService';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.DELIVERY_MANAGE);
    const zones = await DeliveryZoneService.list(session.organizationId, params.id);
    return NextResponse.json({ zones });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.DELIVERY_MANAGE);
    const body = await request.json();
    const input = createDeliveryZoneSchema.parse(body);
    const zone = await DeliveryZoneService.create(session.organizationId, params.id, input, session.userId);
    return NextResponse.json({ zone }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
