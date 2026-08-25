import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateSupplierSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function PATCH(request: NextRequest, { params }: { params: { supplierId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = updateSupplierSchema.parse(body);
    const supplier = await InventoryService.updateSupplier(session.organizationId, params.supplierId, input, session.userId);
    return NextResponse.json({ supplier });
  } catch (error) {
    return toErrorResponse(error);
  }
}
