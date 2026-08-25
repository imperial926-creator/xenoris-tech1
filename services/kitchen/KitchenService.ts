import 'server-only';
import type { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { OrderService } from '@/services/orders/OrderService';

/**
 * Phase 5 — Kitchen Display System (master spec §20).
 *
 * Deliberately thin. The spec's kitchen lifecycle (NEW → ACCEPTED →
 * PREPARING → READY) is the same `OrderStatus` state machine Phase 4 already
 * built and tested — see the "Phase 5 — Kitchen Display System" comment
 * block in schema.prisma for why a second, parallel status enum was NOT
 * created. This service therefore does two things only:
 *
 *   1. `getQueue` — a kitchen-shaped read model over `Order`/`OrderItem`
 *      (active tickets, oldest first, with the item/modifier detail a cook
 *      needs and nothing else).
 *   2. `advanceStatus` — "move this ticket to its next kitchen stage",
 *      which resolves the next status from the current one and then
 *      delegates the actual transition to `OrderService.updateStatus`. The
 *      legality of the transition is therefore checked exactly once, by
 *      OrderService's own whitelist (`ALLOWED_TRANSITIONS`) — this file
 *      does not re-implement or duplicate that decision, it only picks
 *      which forward step to request.
 *
 * Kitchen staff cancelling an order, editing items, or any action beyond
 * "move to the next stage" is out of scope here — that already exists via
 * the general order-status endpoint (`PATCH /orders/[id]/status`) built in
 * Phase 4, gated by the same `order:manage` permission this file reuses.
 */

// Kitchen-relevant statuses only. COMPLETED (picked up/served) and
// CANCELLED are front-of-house/whole-order concerns already handled by
// OrderService — the kitchen's job ends at READY.
const ACTIVE_KITCHEN_STATUSES: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'];

// "What's the next kitchen stage from here" — a convenience lookup, NOT the
// authorization/legality check. OrderService.updateStatus re-validates every
// transition against its own ALLOWED_TRANSITIONS regardless of what this map
// says, so this table being wrong or stale could only ever make advanceStatus
// too conservative, never unsafe.
const KITCHEN_NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING: 'CONFIRMED', // NEW -> ACCEPTED
  CONFIRMED: 'PREPARING', // ACCEPTED -> PREPARING
  PREPARING: 'READY', // PREPARING -> READY
};

const KITCHEN_ORDER_INCLUDE = {
  items: { include: { modifiers: true } },
  table: true,
} satisfies Prisma.OrderInclude;

export class KitchenService {
  /**
   * Active tickets for a branch's kitchen board, oldest first (kitchens work
   * FIFO within a status column). Excludes COMPLETED/CANCELLED orders — once
   * an order leaves READY it's no longer the kitchen's concern.
   */
  static async getQueue(organizationId: string, branchId: string) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.order.findMany({
      where: { organizationId, branchId, status: { in: ACTIVE_KITCHEN_STATUSES } },
      include: KITCHEN_ORDER_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Moves a ticket to its next kitchen stage (NEW->ACCEPTED,
   * ACCEPTED->PREPARING, PREPARING->READY). Rejects orders already at READY
   * or beyond (COMPLETED/CANCELLED) — those aren't kitchen-workflow moves;
   * use the order-status endpoint directly for those.
   */
  static async advanceStatus(organizationId: string, branchId: string, orderId: string, actorUserId: string) {
    const order = await OrderService.get(organizationId, branchId, orderId);
    if (!order) throw new NotFoundError('Order');

    const next = KITCHEN_NEXT_STATUS[order.status];
    if (!next) {
      throw new ConflictError(
        `Order is ${order.status}, which is not a kitchen-workflow stage that can be advanced. ` +
          'The kitchen board only moves orders through PENDING -> CONFIRMED -> PREPARING -> READY.',
      );
    }

    return OrderService.updateStatus(organizationId, branchId, orderId, { status: next }, actorUserId);
  }

  private static async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }
}
