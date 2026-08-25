import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { CustomerFavoriteService } from '@/services/customer/CustomerFavoriteService';
import { toErrorResponse } from '@/lib/utils/api-error';

export async function DELETE(request: NextRequest, { params }: { params: { restaurantId: string; menuItemId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const result = await CustomerFavoriteService.removeFavoriteItem(params.restaurantId, session.customerAccountId, params.menuItemId);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
