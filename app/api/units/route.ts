import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createUnitSchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function GET() {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const units = await InventoryService.listUnits(session.organizationId);
    return NextResponse.json({ units });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = createUnitSchema.parse(body);
    const unit = await InventoryService.createUnit(session.organizationId, input, session.userId);
    return NextResponse.json({ unit }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
