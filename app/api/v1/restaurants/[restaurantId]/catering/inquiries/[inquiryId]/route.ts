import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { CustomerCateringService } from '@/services/customer/CustomerCateringService';
import { toErrorResponse } from '@/lib/utils/api-error';

// Single-inquiry detail (with quotes) — scoped to the requesting diner
// inside CustomerCateringService.get, so another customer's inquiryId 404s
// exactly like it not existing, same "don't leak existence" posture as the
// order/reservation detail routes.
export async function GET(
  request: NextRequest,
  { params }: { params: { restaurantId: string; inquiryId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const inquiry = await CustomerCateringService.get(
      params.restaurantId,
      session.customerAccountId,
      params.inquiryId,
    );
    return NextResponse.json({ inquiry }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
