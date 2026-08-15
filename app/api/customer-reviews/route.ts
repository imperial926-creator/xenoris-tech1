import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createCustomerReviewSchema } from '@/lib/validation/crm';
import { CustomerService } from '@/services/crm/CustomerService';

// Top-level (not nested under /api/customers/[id]) because a review is not
// always linked to a customer profile — see createCustomerReviewSchema's
// comment: a walk-in comment card can stand alone.
export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_MANAGE);
    const body = await request.json();
    const input = createCustomerReviewSchema.parse(body);
    const review = await CustomerService.addReview(session.organizationId, input, session.userId);
    return NextResponse.json({ review }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
