import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { DriverService } from '@/services/delivery/DriverService';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.DELIVERY_MANAGE);
    void params.id; // Branch is not part of the query — DRIVER-role users aren't branch-scoped.
    const users = await DriverService.listEligibleUsers(session.organizationId);
    return NextResponse.json({ users });
  } catch (error) {
    return toErrorResponse(error);
  }
}
