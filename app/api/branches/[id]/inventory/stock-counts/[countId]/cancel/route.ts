import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string; countId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const stockCount = await InventoryService.cancelStockCount(session.organizationId, params.id, params.countId, session.userId);
    return NextResponse.json({ stockCount });
  } catch (error) {
    return toErrorResponse(error);
  }
}
