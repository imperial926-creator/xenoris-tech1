import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { customerCateringPaymentSchema } from '@/lib/validation/customer-catering';
import { CustomerCateringService } from '@/services/customer/CustomerCateringService';
import { toErrorResponse } from '@/lib/utils/api-error';

/**
 * "Pay deposit" / pay towards the remaining balance (spec § 13). Only
 * possible once the quote has been accepted (a CateringEvent exists).
 * Always recorded PENDING — never claim a payment succeeded until the
 * restaurant has confirmed/settled it; see
 * CustomerCateringService.payTowardBalance's JSDoc.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { restaurantId: string; quoteId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const body = await request.json();
    const input = customerCateringPaymentSchema.parse(body);
    const event = await CustomerCateringService.payTowardBalance(
      params.restaurantId,
      session.customerAccountId,
      params.quoteId,
      input,
    );
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
