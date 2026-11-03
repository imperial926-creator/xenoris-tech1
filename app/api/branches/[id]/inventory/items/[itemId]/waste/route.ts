import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { recordWasteSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string; itemId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = recordWasteSchema.parse(body);
    const waste = await InventoryService.recordWaste(session.organizationId, params.id, params.itemId, input, session.userId);
    return NextResponse.json({ waste }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
