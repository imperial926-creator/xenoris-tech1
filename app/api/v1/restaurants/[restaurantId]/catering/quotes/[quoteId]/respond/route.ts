import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { customerQuoteResponseSchema } from '@/lib/validation/customer-catering';
import { CustomerCateringService } from '@/services/customer/CustomerCateringService';
import { toErrorResponse } from '@/lib/utils/api-error';

// "Accept" / "Decline" (spec § 13). Accepting creates the linked
// CateringEvent in the same transaction, exactly as it does for staff —
// see CateringService.updateQuoteStatus / QUOTE_ALLOWED_TRANSITIONS.
export async function POST(
  request: NextRequest,
  { params }: { params: { restaurantId: string; quoteId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const body = await request.json();
    const input = customerQuoteResponseSchema.parse(body);
    const quote = await CustomerCateringService.respondToQuote(
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
