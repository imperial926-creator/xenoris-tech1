import { NextRequest, NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/utils/api-error';
import { CustomerPromotionService } from '@/services/customer/CustomerPromotionService';

/** Single promotion detail — spec § 22's deep-link target ("Open promotion directly"). Public, same reasoning as the list route. */
export async function GET(request: NextRequest, { params }: { params: { restaurantId: string; promotionId: string } }) {
  try {
    const promotion = await CustomerPromotionService.get(params.restaurantId, params.promotionId);
    return NextResponse.json({ promotion });
  } catch (error) {
    return toErrorResponse(error);
  }
}
