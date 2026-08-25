import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { SubscriptionService } from '@/services/platform-billing/SubscriptionService';

export async function POST(_request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.BILLING_MANAGE);
    const subscription = await SubscriptionService.cancel(session.organizationId, session.userId);
    return NextResponse.json({ subscription });
  } catch (error) {
    return toErrorResponse(error);
  }
}
