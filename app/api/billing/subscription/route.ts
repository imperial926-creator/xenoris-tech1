import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { SubscriptionService } from '@/services/platform-billing/SubscriptionService';

// Master spec §54: restaurant owner dashboard's "Subscription: [CURRENT
// PLAN] / Status: ACTIVE|SUSPENDED|CANCELLED" card. No [organizationId]
// path param — always the caller's own organization, from the session,
// same as every other billing route in this tree.
export async function GET(_request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.BILLING_VIEW);
    const subscription = await SubscriptionService.getForOrganization(session.organizationId);
    return NextResponse.json({ subscription });
  } catch (error) {
    return toErrorResponse(error);
  }
}
