import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createBranchSchema } from '@/lib/validation/branch';
import { BranchService } from '@/services/branches/BranchService';

export async function GET() {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.BRANCH_VIEW);
    const branches = await BranchService.list(session.organizationId);
    return NextResponse.json({ branches });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.BRANCH_MANAGE);
    const body = await request.json();
    const input = createBranchSchema.parse(body);
    const branch = await BranchService.create(session.organizationId, input, session.userId);
    return NextResponse.json({ branch }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
