import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { SubscriptionPlanService } from '@/services/platform-billing/SubscriptionPlanService';

// Master spec §7: plans the restaurant owner can pick from at Subscription
// Checkout — ACTIVE only, in display order.
export async function GET(_request: NextRequest) {
  try {
    await requirePermission(await getSession(), PERMISSIONS.BILLING_VIEW);
    const plans = await SubscriptionPlanService.listActive();
    return NextResponse.json({ plans });
  } catch (error) {
    return toErrorResponse(error);
  }
}
