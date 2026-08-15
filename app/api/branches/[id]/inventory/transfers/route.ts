import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { transferStockSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

/** params.id is the SOURCE branch — stock moves from here to input.toBranchId. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = transferStockSchema.parse(body);
    const result = await InventoryService.transferStock(session.organizationId, params.id, input, session.userId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
