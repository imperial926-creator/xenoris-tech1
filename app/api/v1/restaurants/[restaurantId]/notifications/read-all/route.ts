import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { CustomerNotificationService } from '@/services/customer/CustomerNotificationService';

/** Spec § 27 "Mark all as read." */
export async function POST(request: NextRequest, { params }: { params: { restaurantId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const result = await CustomerNotificationService.markAllRead(params.restaurantId, session.customerAccountId);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
