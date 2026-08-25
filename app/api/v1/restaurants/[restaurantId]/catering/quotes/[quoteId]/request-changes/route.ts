import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { customerQuoteChangeRequestSchema } from '@/lib/validation/customer-catering';
import { CustomerCateringService } from '@/services/customer/CustomerCateringService';
import { toErrorResponse } from '@/lib/utils/api-error';

// "Request changes" (spec § 13) — a note attached to the quote, not a
// status transition; see CateringQuote.customerNote's schema comment and
// CustomerCateringService's header comment for why.
export async function POST(
  request: NextRequest,
  { params }: { params: { restaurantId: string; quoteId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const body = await request.json();
    const input = customerQuoteChangeRequestSchema.parse(body);
    const quote = await CustomerCateringService.requestQuoteChanges(
      params.restaurantId,
      session.customerAccountId,
      params.quoteId,
      input,
    );
    return NextResponse.json({ quote }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
