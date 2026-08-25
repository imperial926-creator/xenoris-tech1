import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { CustomerNotificationService } from '@/services/customer/CustomerNotificationService';

/** Unregisters one device (app sign-out, or the OS revoking the token) — a no-op, not an error, if it's already gone or belongs to a different account (see CustomerNotificationService.unregisterPushToken's own comment). */
export async function DELETE(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    await CustomerNotificationService.unregisterPushToken(session.customerAccountId, decodeURIComponent(params.token));
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
