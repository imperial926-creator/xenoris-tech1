import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { completeStockCountSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

/**
 * Named "complete" but accepts a partial batch of counted lines — a count
 * only actually flips to COMPLETED once every line has a countedQuantity,
 * so this can be called more than once as staff work through a physical
 * count in batches. See InventoryService.completeStockCount.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string; countId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = completeStockCountSchema.parse(body);
    const stockCount = await InventoryService.completeStockCount(session.organizationId, params.id, params.countId, input, session.userId);
    return NextResponse.json({ stockCount });
  } catch (error) {
    return toErrorResponse(error);
  }
}
