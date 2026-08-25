import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createVendorSchema } from '@/lib/validation/accounting';
import { AccountingService } from '@/services/accounting/AccountingService';

export async function GET() {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_VIEW);
    const vendors = await AccountingService.listVendors(session.organizationId);
    return NextResponse.json({ vendors });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.FINANCE_MANAGE);
    const body = await request.json();
    const input = createVendorSchema.parse(body);
    const vendor = await AccountingService.createVendor(session.organizationId, input, session.userId);
    return NextResponse.json({ vendor }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
