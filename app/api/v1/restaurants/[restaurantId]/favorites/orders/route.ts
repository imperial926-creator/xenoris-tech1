import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { addFavoriteOrderSchema, listFavoritesQuerySchema } from '@/lib/validation/customer-favorite';
import { CustomerFavoriteService } from '@/services/customer/CustomerFavoriteService';
import { toErrorResponse } from '@/lib/utils/api-error';

/** CAPP Phase 10 — spec § 38 "Favorite orders." A static `orders` segment under `favorites/`, resolved ahead of the sibling `favorites/[menuItemId]` dynamic route — Next.js's normal static-before-dynamic precedence, no conflict. */
export async function GET(request: NextRequest, { params }: { params: { restaurantId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const { searchParams } = new URL(request.url);
    const query = listFavoritesQuerySchema.parse({
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const favorites = await CustomerFavoriteService.listFavoriteOrders(params.restaurantId, session.customerAccountId, query);
    return NextResponse.json({ favorites }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { restaurantId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const body = await request.json();
    const input = addFavoriteOrderSchema.parse(body);
    const favorite = await CustomerFavoriteService.addFavoriteOrder(params.restaurantId, session.customerAccountId, input.orderId);
    return NextResponse.json({ favorite }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
