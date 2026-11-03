import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const items = await InventoryService.getLowStockItems(session.organizationId, params.id);
    return NextResponse.json({ items });
  } catch (error) {
    return toErrorResponse(error);
  }
}
