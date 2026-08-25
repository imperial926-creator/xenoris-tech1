import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import {
  customerCreateCateringInquirySchema,
  customerListCateringInquiriesQuerySchema,
} from '@/lib/validation/customer-catering';
import { CustomerCateringService } from '@/services/customer/CustomerCateringService';
import { toErrorResponse } from '@/lib/utils/api-error';

/**
 * GET  — the diner's own catering inquiries at this restaurant, each with
 *        its quotes (spec § 13's funnel).
 * POST — submits a catering inquiry ("BOOK CATERING", spec § 13). Contact
 *        identity is server-resolved from the authenticated customer
 *        profile; see CustomerCateringService.createInquiry.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { restaurantId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const { searchParams } = new URL(request.url);
    const query = customerListCateringInquiriesQuerySchema.parse({
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const inquiries = await CustomerCateringService.list(params.restaurantId, session.customerAccountId, query);
    return NextResponse.json({ inquiries }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { restaurantId: string } },
) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    const body = await request.json();
    const input = customerCreateCateringInquirySchema.parse(body);
    const inquiry = await CustomerCateringService.createInquiry(
      params.restaurantId,
      session.customerAccountId,
      input,
    );
    return NextResponse.json({ inquiry }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
