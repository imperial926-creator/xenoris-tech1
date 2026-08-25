import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { CustomerService } from '@/services/crm/CustomerService';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { customerId: string; key: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_MANAGE);
    // Phase 15 hardening: was {result} — see the sibling addresses/[id]
    // route's comment for the full rationale.
    const preference = await CustomerService.removePreference(
      session.organizationId, params.customerId, decodeURIComponent(params.key), session.userId,
    );
    return NextResponse.json({ preference });
  } catch (error) {
    return toErrorResponse(error);
  }
}
