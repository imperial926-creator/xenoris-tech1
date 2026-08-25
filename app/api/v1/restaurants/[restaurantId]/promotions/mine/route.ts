import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { listMyPromotionsQuerySchema } from '@/lib/validation/promotion';
import { CustomerPromotionService } from '@/services/customer/CustomerPromotionService';

/** Spec § 23's "Personalized offers"/"Saved offers"/"Expired offers" — every promotion this diner has claimed/redeemed here, each with its `effectiveStatus` so the mobile app can bucket them without recomputing the date math client-side. */
export async function GET(request: NextRequest, { params }: { params: { restaurantId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const { searchParams } = new URL(request.url);
    const query = listMyPromotionsQuerySchema.parse({
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const claims = await CustomerPromotionService.listMine(params.restaurantId, session.customerAccountId, query);
    return NextResponse.json({ claims });
  } catch (error) {
    return toErrorResponse(error);
  }
}
