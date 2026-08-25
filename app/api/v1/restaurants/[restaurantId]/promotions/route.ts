import { NextRequest, NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/utils/api-error';
import { CustomerPromotionService } from '@/services/customer/CustomerPromotionService';

/**
 * Spec § 23's "Active promotions"/"Upcoming promotions" — the in-app
 * promotion center's public feed. Deliberately unauthenticated, same as
 * `GET .../menu`: a diner browsing before creating an account should still
 * see what's on offer (spec § 1 item 15 "View promotions" has no login
 * gate). Personalized/saved/expired offers require a signed-in diner — see
 * `GET .../promotions/mine` instead.
 */
export async function GET(request: NextRequest, { params }: { params: { restaurantId: string } }) {
  try {
    const { active, upcoming } = await CustomerPromotionService.listActive(params.restaurantId);
    return NextResponse.json({ active, upcoming });
  } catch (error) {
    return toErrorResponse(error);
  }
}
