import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createCateringPackageSchema } from '@/lib/validation/catering';
import { CateringService } from '@/services/catering/CateringService';

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const packages = await CateringService.listPackages(session.organizationId, params.id);
    return NextResponse.json({ packages });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const body = await request.json();
    const input = createCateringPackageSchema.parse(body);
    const pkg = await CateringService.createPackage(session.organizationId, params.id, input, session.userId);
    return NextResponse.json({ package: pkg }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
