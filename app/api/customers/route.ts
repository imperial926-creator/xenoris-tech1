import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createCustomerSchema, listCustomersQuerySchema } from '@/lib/validation/crm';
import { CustomerService } from '@/services/crm/CustomerService';

export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_VIEW);
    const { searchParams } = new URL(request.url);
    const query = listCustomersQuerySchema.parse({
      status: searchParams.get('status') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const customers = await CustomerService.list(session.organizationId, query);
    return NextResponse.json({ customers });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_MANAGE);
    const body = await request.json();
    const input = createCustomerSchema.parse(body);
    const customer = await CustomerService.create(session.organizationId, input, session.userId);
    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
