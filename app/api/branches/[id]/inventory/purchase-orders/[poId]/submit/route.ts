import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string; poId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const purchaseOrder = await InventoryService.submitPurchaseOrder(session.organizationId, params.id, params.poId, session.userId);
    return NextResponse.json({ purchaseOrder });
  } catch (error) {
    return toErrorResponse(error);
  }
}
