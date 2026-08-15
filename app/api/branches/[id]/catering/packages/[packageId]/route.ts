import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateCateringPackageSchema } from '@/lib/validation/catering';
import { CateringService } from '@/services/catering/CateringService';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; packageId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const pkg = await CateringService.getPackage(session.organizationId, params.id, params.packageId);
    return NextResponse.json({ package: pkg });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; packageId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const body = await request.json();
    const input = updateCateringPackageSchema.parse(body);
    const pkg = await CateringService.updatePackage(session.organizationId, params.id, params.packageId, input, session.userId);
    return NextResponse.json({ package: pkg });
  } catch (error) {
    return toErrorResponse(error);
  }
}
