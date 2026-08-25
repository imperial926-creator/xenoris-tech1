import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { registerPushTokenSchema } from '@/lib/validation/customer-notification';
import { CustomerNotificationService } from '@/services/customer/CustomerNotificationService';

/**
 * Spec § 47 device registration. Account-wide, same reasoning as
 * `/api/v1/customer/notification-preferences` — a push token belongs to a
 * device, not a restaurant. No mobile call site produces a real token yet
 * (see architecture.md § 18) — this endpoint is real and ready for one.
 */
export async function POST(request: NextRequest) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const body = await request.json();
    const input = registerPushTokenSchema.parse(body);
    const token = await CustomerNotificationService.registerPushToken(session.customerAccountId, input);
    return NextResponse.json({ token }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
