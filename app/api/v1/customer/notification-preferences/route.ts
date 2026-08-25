import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateNotificationPreferencesSchema } from '@/lib/validation/customer-notification';
import { CustomerNotificationService } from '@/services/customer/CustomerNotificationService';

/**
 * Spec § 26 "Promotion notification preferences." Deliberately NOT nested
 * under `/restaurants/:restaurantId/**` like every other customer route —
 * `CustomerNotificationPreference` is 1:1 with `CustomerAccount`, not
 * `Organization` (see schema.prisma), so a diner's opt-ins are one set of
 * settings across every restaurant this app-install ever connects to, the
 * same account-wide scope `/api/v1/auth/*` already has. `/api/v1/customer/*`
 * is this the first route in that scope beyond auth itself.
 */
export async function GET(request: NextRequest) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const preferences = await CustomerNotificationService.getPreferences(session.customerAccountId);
    return NextResponse.json({ preferences });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const body = await request.json();
    const input = updateNotificationPreferencesSchema.parse(body);
    const preferences = await CustomerNotificationService.updatePreferences(session.customerAccountId, input);
    return NextResponse.json({ preferences });
  } catch (error) {
    return toErrorResponse(error);
  }
}
