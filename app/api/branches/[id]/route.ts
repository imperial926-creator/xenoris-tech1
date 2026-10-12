
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateBranchSchema } from '@/lib/validation/branch';
import { BranchService } from '@/services/branches/BranchService';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await requirePermission(await getSession(), PERMISSIONS.BRANCH_VIEW);
    const branch = await BranchService.get(session.organizationId, id);
    return NextResponse.json({ branch });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await requirePermission(await getSession(), PERMISSIONS.BRANCH_MANAGE);
    const body = await request.json();
    const input = updateBranchSchema.parse(body);
    const branch = await BranchService.update(
      session.organizationId,
      id,
      input,
      session.userId,
    );
    return NextResponse.json({ branch });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await requirePermission(await getSession(), PERMISSIONS.BRANCH_MANAGE);
    const branch = await BranchService.deactivate(session.organizationId, id, session.userId);
    return NextResponse.json({ branch });
  } catch (error) {
    return toErrorResponse(error);
  }
}

