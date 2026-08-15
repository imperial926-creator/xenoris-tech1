import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { setCustomerPreferenceSchema } from '@/lib/validation/crm';
import { CustomerService } from '@/services/crm/CustomerService';

// POST is an upsert-by-key (see CustomerService.setPreference) — posting an
// existing key updates its value rather than creating a duplicate row.
export async function POST(request: NextRequest, { params }: { params: { customerId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_MANAGE);
    const body = await request.json();
    const input = setCustomerPreferenceSchema.parse(body);
    const preference = await CustomerService.setPreference(session.organizationId, params.customerId, input, session.userId);
    return NextResponse.json({ preference }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
