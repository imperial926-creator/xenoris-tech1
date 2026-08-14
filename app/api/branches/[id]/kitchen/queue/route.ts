import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { KitchenService } from '@/services/kitchen/KitchenService';

/**
 * Read-only kitchen board feed. Gated by `kitchen:view` (a distinct,
 * narrower permission than `order:manage`) since a cook needs to see the
 * queue but doesn't necessarily need every order-management capability.
 * The board polls this endpoint client-side for near-real-time updates —
 * see components/kitchen/kitchen-board.tsx for why (no WebSocket/Pusher
 * infra is configured in this build).
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.KITCHEN_VIEW);
    const orders = await KitchenService.getQueue(session.organizationId, params.id);
    return NextResponse.json({ orders });
  } catch (error) {
    return toErrorResponse(error);
  }
}
