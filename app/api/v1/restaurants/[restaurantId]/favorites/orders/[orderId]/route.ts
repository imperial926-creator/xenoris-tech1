import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { CustomerFavoriteService } from '@/services/customer/CustomerFavoriteService';
import { toErrorResponse } from '@/lib/utils/api-error';

export async function DELETE(request: NextRequest, { params }: { params: { restaurantId: string; orderId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const result = await CustomerFavoriteService.removeFavoriteOrder(params.restaurantId, session.customerAccountId, params.orderId);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
