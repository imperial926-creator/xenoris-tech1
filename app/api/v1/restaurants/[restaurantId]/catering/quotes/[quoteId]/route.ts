import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { CustomerCateringService } from '@/services/customer/CustomerCateringService';
import { toErrorResponse } from '@/lib/utils/api-error';

// Single-quote detail, scoped to the requesting diner. The first GET after
// staff send a quote auto-transitions SENT -> VIEWED (a real "read
// receipt") and the response includes `balance` for spec § 13's "View
// balance" — see CustomerCateringService.getQuote's JSDoc.
export async function GET(
  request: NextRequest,
  { params }: { params: { restaurantId: string; quoteId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const quote = await CustomerCateringService.getQuote(
      params.restaurantId,
      session.customerAccountId,
      params.quoteId,
    );
    return NextResponse.json({ quote }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
