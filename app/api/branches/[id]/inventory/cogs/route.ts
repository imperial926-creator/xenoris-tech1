import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { InventoryService } from '@/services/inventory/InventoryService';

const cogsQuerySchema = z.object({ orderId: z.string().trim().min(1) });

/** ?orderId=... -> the real, recipe-driven ingredient cost of that order's SALE_CONSUMPTION transactions (master spec §37's Phase-9 slice — see InventoryService.getCogsForOrder). */
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.INVENTORY_MANAGE);
    const { searchParams } = new URL(request.url);
    const { orderId } = cogsQuerySchema.parse({ orderId: searchParams.get('orderId') ?? undefined });
    const cogs = await InventoryService.getCogsForOrder(session.organizationId, params.id, orderId);
    return NextResponse.json({ orderId, cogs: cogs.toFixed(2) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
