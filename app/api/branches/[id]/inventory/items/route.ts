import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createInventoryItemSchema, listInventoryItemsQuerySchema } from '@/lib/validation/inventory';
import { InventoryService } from '@/services/inventory/InventoryService';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const { searchParams } = new URL(request.url);
    const query = listInventoryItemsQuerySchema.parse({
      lowStockOnly: searchParams.get('lowStockOnly') ?? undefined,
      search: searchParams.get('search') ?? undefined,
    });
    const items = await InventoryService.listInventoryItems(session.organizationId, params.id, query);
    return NextResponse.json({ items });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const body = await request.json();
    const input = createInventoryItemSchema.parse(body);
    const item = await InventoryService.createInventoryItem(session.organizationId, params.id, input, session.userId);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
