import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { KitchenService } from '@/services/kitchen/KitchenService';

/**
 * Moves a ticket to its next kitchen stage. Requires `order:manage`, not
 * just `kitchen:view` — this is a state-changing action, same permission
 * the general order-status endpoint requires (Phase 4), since it's the same
 * underlying transition (`OrderService.updateStatus`) under the hood.
 */
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ id: string; orderId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.ORDER_MANAGE);
    const order = await KitchenService.advanceStatus(
      session.organizationId,
      params.id,
      params.orderId,
      session.userId,
    );
    return NextResponse.json({ order });
  } catch (error) {
    return toErrorResponse(error);
  }
}
