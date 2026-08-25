import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createSubscriptionCheckoutSchema } from '@/lib/validation/platform-billing';
import { SubscriptionService } from '@/services/platform-billing/SubscriptionService';

// Master spec §6/§9: [SUBSCRIBE] -> Subscription Checkout. Returns the
// checkout preview (master spec §8's field list) plus, if a gateway is
// configured, where to send the owner for secure card entry.
export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.BILLING_MANAGE);
    const body = createSubscriptionCheckoutSchema.parse(await request.json());
    const checkout = await SubscriptionService.createCheckout(session.organizationId, body.planId, session.userId);
    return NextResponse.json({ checkout });
  } catch (error) {
    return toErrorResponse(error);
  }
}
