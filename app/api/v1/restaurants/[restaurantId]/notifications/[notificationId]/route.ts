import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { CustomerNotificationService } from '@/services/customer/CustomerNotificationService';

/** Spec § 27 "Mark as read." PATCH rather than POST — this is an idempotent state change on an existing resource, matching the convention `.../promotions/[promotionId]/status` already uses for a single-field update. */
export async function PATCH(request: NextRequest, { params }: { params: { restaurantId: string; notificationId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const notification = await CustomerNotificationService.markRead(params.restaurantId, session.customerAccountId, params.notificationId);
    return NextResponse.json({ notification });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Spec § 27 "Delete where appropriate." */
export async function DELETE(request: NextRequest, { params }: { params: { restaurantId: string; notificationId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const result = await CustomerNotificationService.remove(params.restaurantId, session.customerAccountId, params.notificationId);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
