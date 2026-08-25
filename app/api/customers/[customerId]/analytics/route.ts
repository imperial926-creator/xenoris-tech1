import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { CustomerService } from '@/services/crm/CustomerService';

export async function GET(_request: NextRequest, { params }: { params: { customerId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_VIEW);
    const analytics = await CustomerService.getAnalytics(session.organizationId, params.customerId);
    return NextResponse.json({ analytics });
  } catch (error) {
    return toErrorResponse(error);
  }
}
