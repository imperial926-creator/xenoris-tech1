import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateUnitSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function PATCH(request: NextRequest, props: { params: Promise<{ unitId: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = updateUnitSchema.parse(body);
    const unit = await InventoryService.updateUnit(session.organizationId, params.unitId, input, session.userId);
    return NextResponse.json({ unit });
  } catch (error) {
    return toErrorResponse(error);
  }
}
