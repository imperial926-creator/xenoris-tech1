import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateDriverSchema } from '@/lib/validation/delivery';
import { DriverService } from '@/services/delivery/DriverService';

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ id: string; driverId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.DELIVERY_MANAGE);
    const driver = await DriverService.get(session.organizationId, params.id, params.driverId);
    return NextResponse.json({ driver });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string; driverId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.DELIVERY_MANAGE);
    const body = await request.json();
    const input = updateDriverSchema.parse(body);
    const driver = await DriverService.update(session.organizationId, params.id, params.driverId, input, session.userId);
    return NextResponse.json({ driver });
  } catch (error) {
    return toErrorResponse(error);
  }
}
