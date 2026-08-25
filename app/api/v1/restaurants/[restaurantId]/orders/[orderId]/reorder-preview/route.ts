import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { CustomerOrderService } from '@/services/customer/CustomerOrderService';
import { toErrorResponse } from '@/lib/utils/api-error';

/** CAPP Phase 10 — spec § 38 "ORDER AGAIN": read-only availability-checked preview of a past order, ready for the client to prefill a new cart. See CustomerOrderService.previewReorder's own header for the preview/checkout split. */
export async function GET(request: NextRequest, { params }: { params: { restaurantId: string; orderId: string } }) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const preview = await CustomerOrderService.previewReorder(params.restaurantId, session.customerAccountId, params.orderId);
    return NextResponse.json({ preview }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
