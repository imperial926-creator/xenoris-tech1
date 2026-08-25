import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { validatePromoCodeSchema } from '@/lib/validation/promotion';
import { CustomerPromotionService } from '@/services/customer/CustomerPromotionService';

/**
 * Cart-preview endpoint the checkout screen calls before placing an order,
 * so the diner sees a promo code's discount before committing. Informational
 * only — see CustomerPromotionService.previewDiscount's header comment for
 * why the authoritative number is always recomputed again inside
 * `OrderService.createOrder`, never trusted from here.
 */
export async function POST(request: NextRequest, { params }: { params: { restaurantId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const body = await request.json();
    const input = validatePromoCodeSchema.parse(body);
    const preview = await CustomerPromotionService.previewDiscount(params.restaurantId, session.customerAccountId, input);
    return NextResponse.json(preview);
  } catch (error) {
    return toErrorResponse(error);
  }
}
