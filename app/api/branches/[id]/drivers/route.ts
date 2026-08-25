import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createDriverSchema } from '@/lib/validation/delivery';
import { DriverService } from '@/services/delivery/DriverService';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.DELIVERY_MANAGE);
    const drivers = await DriverService.list(session.organizationId, params.id);
    return NextResponse.json({ drivers });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.DELIVERY_MANAGE);
    const body = await request.json();
    const input = createDriverSchema.parse(body);
    const driver = await DriverService.create(session.organizationId, params.id, input, session.userId);
    return NextResponse.json({ driver }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
