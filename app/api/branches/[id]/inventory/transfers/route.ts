import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { transferStockSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

/** params.id is the SOURCE branch — stock moves from here to input.toBranchId. */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = transferStockSchema.parse(body);
    const result = await InventoryService.transferStock(session.organizationId, params.id, input, session.userId);
    // Phase 15 hardening: was a bare NextResponse.json(result, ...), unlike
    // every other route in this tree, which wraps its resource under a
    // named key (e.g. DELETE /branches/[id] returns {branch}). No
    // dashboard UI consumes this route yet, so this is a clean fix, not a
    // breaking one.
    return NextResponse.json({ transfer: result }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
