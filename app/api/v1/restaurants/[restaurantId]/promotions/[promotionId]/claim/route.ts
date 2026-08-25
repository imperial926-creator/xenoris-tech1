import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { CustomerPromotionService } from '@/services/customer/CustomerPromotionService';

/** Spec § 24 "SAVE OFFER"/"CLAIM OFFER" — creates (or idempotently returns) this diner's CustomerPromotion claim record. */
export async function POST(request: NextRequest, { params }: { params: { restaurantId: string; promotionId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const claim = await CustomerPromotionService.claim(params.restaurantId, session.customerAccountId, params.promotionId);
    return NextResponse.json({ claim }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
