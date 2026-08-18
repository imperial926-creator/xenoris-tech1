import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse, NotFoundError } from '@/lib/utils/api-error';
import { updateOrganizationSchema } from '@/lib/validation/organization';
import { OrganizationService } from '@/services/organizations/OrganizationService';

// Note: an organization's id in the URL must match the caller's own
// organization — this platform does not allow cross-tenant reads even for
// administrators of a different organization.
//
// Phase 15 hardening: was a bespoke `throw new Error('FORBIDDEN_TENANT_
// MISMATCH')` + a manual NextResponse.json in every catch block, bypassing
// toErrorResponse's centralized error->status mapping every other route in
// this tree relies on. NotFoundError is exactly the right shape here (same
// 404 status, same "don't reveal whether the org exists" behavior) and
// routes through the one mapping function like everything else.
function assertSameOrg(paramsId: string, sessionOrgId: string) {
  if (paramsId !== sessionOrgId) {
    throw new NotFoundError('Organization');
  }
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.BRANCH_VIEW);
    assertSameOrg(params.id, session.organizationId);
    const org = await OrganizationService.get(params.id);
    return NextResponse.json({ organization: org });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ORG_MANAGE);
    assertSameOrg(params.id, session.organizationId);
    const body = await request.json();
    const input = updateOrganizationSchema.parse(body);
    const org = await OrganizationService.update(params.id, input, session.userId);
    return NextResponse.json({ organization: org });
  } catch (error) {
    return toErrorResponse(error);
  }
}
