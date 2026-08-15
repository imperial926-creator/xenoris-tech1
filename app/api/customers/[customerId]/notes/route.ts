import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createCustomerNoteSchema } from '@/lib/validation/crm';
import { CustomerService } from '@/services/crm/CustomerService';

export async function POST(request: NextRequest, { params }: { params: { customerId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CUSTOMER_MANAGE);
    const body = await request.json();
    const input = createCustomerNoteSchema.parse(body);
    const note = await CustomerService.addNote(session.organizationId, params.customerId, input.note, session.userId);
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
