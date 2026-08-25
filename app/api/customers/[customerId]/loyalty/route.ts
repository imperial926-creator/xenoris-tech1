import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { LoyaltyService } from '@/services/loyalty/LoyaltyService';

/** CAPP Phase 10 — spec § 37. Read-only staff view of a customer's loyalty standing; no dashboard page built for it this phase (same established CAPP boundary), reachable via this API for now. */
export async function GET(_request: NextRequest, { params }: { params: { customerId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_VIEW);
    const loyalty = await LoyaltyService.getSummaryForCustomer(session.organizationId, params.customerId);
    return NextResponse.json({ loyalty });
  } catch (error) {
    return toErrorResponse(error);
  }
}
