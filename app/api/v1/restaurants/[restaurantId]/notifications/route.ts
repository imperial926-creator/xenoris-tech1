import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { listNotificationsQuerySchema } from '@/lib/validation/customer-notification';
import { CustomerNotificationService } from '@/services/customer/CustomerNotificationService';

/** Spec § 27 "Notification Center" — this diner's own notification history, newest first, with the unread count the mobile app's badge needs. */
export async function GET(request: NextRequest, { params }: { params: { restaurantId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const { searchParams } = new URL(request.url);
    const query = listNotificationsQuerySchema.parse({
      category: searchParams.get('category') ?? undefined,
      unreadOnly: searchParams.get('unreadOnly') ?? undefined,
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const result = await CustomerNotificationService.list(params.restaurantId, session.customerAccountId, query);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
