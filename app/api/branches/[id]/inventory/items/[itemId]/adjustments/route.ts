import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { recordAdjustmentSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function POST(request: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = recordAdjustmentSchema.parse(body);
    const transaction = await InventoryService.recordAdjustment(session.organizationId, params.id, params.itemId, input, session.userId);
    return NextResponse.json({ transaction }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
