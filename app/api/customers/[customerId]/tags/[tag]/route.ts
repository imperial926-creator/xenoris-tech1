import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { CustomerService } from '@/services/crm/CustomerService';

export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ customerId: string; tag: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_MANAGE);
    // Phase 15 hardening: was {result} — see the sibling addresses/[id]
    // route's comment for the full rationale (matches the DELETE
    // /branches/[id] -> {branch} convention; no UI consumer reads this
    // response body).
    const tag = await CustomerService.removeTag(
      session.organizationId, params.customerId, decodeURIComponent(params.tag), session.userId,
    );
    return NextResponse.json({ tag });
  } catch (error) {
    return toErrorResponse(error);
  }
}
