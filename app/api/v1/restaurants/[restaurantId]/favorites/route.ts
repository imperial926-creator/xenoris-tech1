import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { addFavoriteItemSchema, listFavoritesQuerySchema } from '@/lib/validation/customer-favorite';
import { CustomerFavoriteService } from '@/services/customer/CustomerFavoriteService';
import { toErrorResponse } from '@/lib/utils/api-error';

/**
 * CAPP Phase 10 — spec § 38 "Favorite items." Bearer-auth gated, same
 * personal-data pattern as the addresses/notifications routes. Favorite
 * *orders* live at the sibling `favorites/orders` route, not here — see
 * that route's own header.
 */
export async function GET(request: NextRequest, { params }: { params: { restaurantId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const { searchParams } = new URL(request.url);
    const query = listFavoritesQuerySchema.parse({
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const favorites = await CustomerFavoriteService.listFavoriteItems(params.restaurantId, session.customerAccountId, query);
    return NextResponse.json({ favorites }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { restaurantId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const body = await request.json();
    const input = addFavoriteItemSchema.parse(body);
    const favorite = await CustomerFavoriteService.addFavoriteItem(params.restaurantId, session.customerAccountId, input.menuItemId);
    return NextResponse.json({ favorite }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
