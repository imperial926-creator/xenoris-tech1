import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';
import { isBranchOpenNow } from '@/lib/utils/business-hours';
import { OrderService, ORDER_INCLUDE } from '@/services/orders/OrderService';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import type {
  CustomerCreateOrderInput,
  CustomerListOrdersQueryInput,
} from '@/lib/validation/customer-order';

const OPEN_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'] as const;

/**
 * CAPP Phase 4 — take-out ordering, spec § 11. This is the customer app's
 * only entry point into the order system, same "reuse the staff
 * transaction, never a parallel pipeline" shape as `CustomerReservationService`.
 *
 * CAPP Phase 5 extends this to `type: 'DELIVERY'` (spec § 12). Two honest
 * scope decisions, both forced by what actually exists in this codebase
 * (see docs/customer-app/architecture.md § 14 for the full writeup):
 *
 * 1. Zone selection, not address-to-zone matching. `DeliveryZone` rows are
 *    plain staff-named areas with no lat/lng/polygon anywhere in this
 *    schema, and `DeliveryZoneService` has no "resolve zone from address"
 *    method. Rather than inventing geocoding infrastructure that exists
 *    nowhere else in this platform (against "reuse existing infrastructure"
 *    / "no fake integrations"), the diner picks their zone directly from
 *    `GET /delivery-zones` (DeliveryZoneService.listActive) — their address
 *    is where the order gets delivered, not something the system claims to
 *    auto-map to a zone.
 * 2. No delivery ETA. `DeliveryOrder.estimatedDeliveryAt` is a real schema
 *    column, but no code path in this entire codebase — staff or system —
 *    ever sets it. Promising a delivery time window would be exactly the
 *    kind of unverified claim the spec's dev principles forbid ("Do not
 *    claim an order ... is successful until the backend has verified it").
 *    Delivery orders therefore carry no diner-chosen or system-estimated
 *    time; the diner "tracks" a delivery order the same way the whole
 *    codebase tracks one — polling `DeliveryOrder.status` via this order's
 *    `delivery` relation (already on `ORDER_INCLUDE`) and, for the fuller
 *    timeline, `getDeliveryStatusHistory` below. There is no live map/GPS
 *    view — `Driver` has zero location fields.
 */
export class CustomerOrderService {
  /**
   * Places a take-out or delivery order for the authenticated diner.
   * Server-computed pricing is entirely `OrderService.createOrder`'s job
   * (menu item/variant/modifier lookup, availability checks, totals,
   * delivery-zone fee snapshot, companion DeliveryOrder creation) — this
   * method's own responsibility is resolving the diner's identity,
   * validating the requested pickup time (TAKEOUT) or delivery address
   * (DELIVERY), and recording their stated payment method.
   *
   * Payment: there is no real payment gateway (`lib/payments/PaymentProvider.ts`
   * is an intentionally-unimplemented seam). The spec's own dev principles
   * are explicit — "Do not fake payments" / "Do not claim ... a payment is
   * successful until the backend has verified it" — so this never creates
   * an `OrderPayment` row with `status: 'COMPLETED'`. It records the
   * diner's chosen method at `status: 'PENDING'`: real, useful data ("this
   * customer intends to pay via GCash") without ever claiming money has
   * actually moved. Staff settle it for real via the existing
   * `OrderService.recordPayment` (unchanged, still staff-only) once payment
   * is actually confirmed at pickup/delivery or a real gateway is wired in.
   */
  static async createOrder(
    publicCode: string,
    customerAccountId: string,
    input: CustomerCreateOrderInput,
  ) {
    const { organizationId, branchId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await CustomerAccountService.getOrCreateCustomerProfile(organizationId, customerAccountId);
    const account = await prisma.customerAccount.findUniqueOrThrow({ where: { id: customerAccountId } });

    let requiredAt: string | undefined;
    let deliveryAddress: string | undefined;

    if (input.type === 'TAKEOUT') {
      const pickupTime = this.parsePickupTime(input.pickupTime!);
      await this.assertBranchOpenAt(organizationId, branchId, pickupTime);
      requiredAt = input.pickupTime;
    } else {
      // DELIVERY: no diner-chosen time (see this class's header comment) —
      // instead this checks the branch is open for business RIGHT NOW,
      // since a delivery order starts moving toward the kitchen
      // immediately, unlike a scheduled pickup.
      await this.assertBranchOpenAt(organizationId, branchId, new Date());
      deliveryAddress = await this.resolveDeliveryAddress(customer.id, input);
    }

    const order = await OrderService.createOrder(
      organizationId,
      branchId,
      {
        type: input.type,
        customerId: customer.id,
        guestName: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || account.firstName,
        guestEmail: customer.email ?? account.email ?? undefined,
        guestPhone: customer.phone ?? account.mobile ?? undefined,
        notes: input.notes,
        requiredAt,
        deliveryAddress,
        deliveryZoneId: input.deliveryZoneId,
        discountAmount: '0.00',
        promoCode: input.promoCode,
        items: input.items,
      },
      // No staff actor — see the JSDoc on OrderService.createOrder for why
      // a CustomerAccount id must never be passed here instead.
      null,
    );

    const withPayment = await OrderService.recordPayment(
      organizationId,
      branchId,
      order.id,
      {
        method: input.paymentMethod,
        amount: order.total.toFixed(2),
        status: 'PENDING',
        note:
          input.type === 'DELIVERY'
            ? 'Customer-selected payment method at checkout — pending confirmation/settlement on delivery.'
            : 'Customer-selected payment method at checkout — pending confirmation/settlement at pickup.',
      },
      null,
    );

    // Same reasoning as CustomerReservationService.createReservation's
    // second audit entry: OrderService's own internal audit log already
    // recorded this with `userId: null` (honest — no staff actor); this
    // customer-scoped entry is what actually lets anyone trace "which
    // CustomerAccount placed this order" later.
    await writeAuditLog(prisma, {
      organizationId,
      branchId,
      action: 'order.customer_create',
      entityType: 'Order',
      entityId: order.id,
      newValue: {
        customerAccountId,
        customerId: customer.id,
        type: input.type,
        paymentMethod: input.paymentMethod,
      },
    });

    return withPayment;
  }

  /** A diner's own order history at this restaurant (spec § 1 item 18, "View order history"; extended in Phase 5 to include delivery orders alongside take-out). */
  static async list(publicCode: string, customerAccountId: string, query: CustomerListOrdersQueryInput) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await CustomerAccountService.findCustomerProfile(organizationId, customerAccountId);
    if (!customer) return [];

    return prisma.order.findMany({
      where: {
        organizationId,
        customerId: customer.id,
        // Scoped to what this customer-facing service can actually create
        // (TAKEOUT/DELIVERY) — never DINE_IN, which this app never places.
        type: query.type ?? { in: ['TAKEOUT', 'DELIVERY'] },
        ...(query.openOnly ? { status: { in: [...OPEN_ORDER_STATUSES] } } : {}),
      },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
    });
  }

  /** Single order detail, scoped to the requesting diner — never another customer's order, even at the same restaurant. Includes `delivery` (zone/driver/status) via ORDER_INCLUDE for DELIVERY orders — the customer app's order-tracking view. */
  static async get(publicCode: string, customerAccountId: string, orderId: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await CustomerAccountService.findCustomerProfile(organizationId, customerAccountId);
    if (!customer) throw new NotFoundError('Order');

    const order = await prisma.order.findFirst({
      where: { id: orderId, organizationId, customerId: customer.id },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundError('Order');
    return order;
  }

  /**
   * The delivery status timeline for one of this diner's own delivery
   * orders (spec item 13, "Track order status", applied to delivery — spec
   * § 12). Mirrors the staff-facing `DeliveryService.getStatusHistory`
   * shape exactly (same `DeliveryStatusHistory` rows), scoped to the
   * requesting diner the same way `get` above is. 404s (not empty array)
   * for a take-out order or another customer's order — same "don't leak
   * existence" posture as every other customer-scoped lookup in this file.
   */
  /**
   * CAPP Phase 10 — spec § 38 "ORDER AGAIN": "The system should check
   * whether previous items are still available." Read-only — this does not
   * place an order, it hands the client a cart-shaped preview (one entry
   * per past `OrderItem`, each flagged `available`/`unavailableReason`) the
   * diner reviews before actually submitting via the normal `POST /orders`
   * (which re-validates everything fresh — same "preview, then an
   * independently-authoritative checkout" split
   * `PromotionService.validateAndPreviewDiscount` already established for
   * promo codes). Deliberately does not re-check each item's modifier-group
   * required/minSelect/maxSelect rules the way `OrderService.
   * resolveAndPriceItems` does at real checkout — group composition rarely
   * changes between a past order and a reorder, and the authoritative
   * checkout call catches it if it ever does; re-implementing that whole
   * validation here for a read-only preview would be scope this endpoint
   * doesn't need.
   */
  static async previewReorder(publicCode: string, customerAccountId: string, orderId: string) {
    const order = await this.get(publicCode, customerAccountId, orderId);

    const modifierIds = [...new Set(order.items.flatMap((item) => item.modifiers.map((m) => m.modifierId)))];
    const liveModifiers = modifierIds.length
      ? await prisma.menuModifier.findMany({ where: { id: { in: modifierIds } }, select: { id: true, name: true, priceDelta: true, active: true } })
      : [];
    const liveModifierById = new Map<string, (typeof liveModifiers)[number]>(liveModifiers.map((m) => [m.id, m]));

    const items = order.items.map((item) => {
      const reasons: string[] = [];
      if (!item.menuItem.active || !item.menuItem.available) {
        reasons.push(`"${item.menuItem.name}" is no longer available.`);
      }
      if (item.variant && !item.variant.active) {
        reasons.push(`"${item.variant.name}" is no longer available.`);
      }
      // Current live modifier data where it still exists/is active (name,
      // price — a reorder should reflect today's prices, same principle as
      // `currentUnitPrice` below), falling back to the original order's own
      // snapshot for one that's been deactivated since — so the client can
      // still show what was ordered even though it can't be re-added.
      const modifiers = item.modifiers.map((m) => {
        const live = liveModifierById.get(m.modifierId);
        return {
          id: m.modifierId,
          name: live?.name ?? m.nameSnapshot,
          priceDelta: live?.priceDelta ?? m.priceDeltaSnapshot,
          active: Boolean(live?.active),
        };
      });
      const unavailableModifiers = modifiers.filter((m) => !m.active);
      if (unavailableModifiers.length > 0) {
        reasons.push(`${unavailableModifiers.map((m) => m.name).join(', ')} no longer available.`);
      }

      return {
        menuItemId: item.menuItemId,
        menuItemVariantId: item.menuItemVariantId,
        quantity: item.quantity,
        modifiers,
        notes: item.notes,
        nameSnapshot: item.nameSnapshot,
        currentUnitPrice: item.variant ? item.variant.price : item.menuItem.price,
        available: reasons.length === 0,
        unavailableReason: reasons.length > 0 ? reasons.join(' ') : undefined,
      };
    });

    return { orderId: order.id, items, anyUnavailable: items.some((i) => !i.available) };
  }

  static async getDeliveryStatusHistory(publicCode: string, customerAccountId: string, orderId: string) {
    const order = await this.get(publicCode, customerAccountId, orderId);
    if (!order.delivery) throw new NotFoundError('Delivery');
    return prisma.deliveryStatusHistory.findMany({
      where: { deliveryOrderId: order.delivery.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // --- helpers ------------------------------------------------------------

  private static parsePickupTime(pickupTimeRaw: string): Date {
    const pickupTime = new Date(pickupTimeRaw);
    if (Number.isNaN(pickupTime.getTime())) {
      throw new ConflictError('pickupTime is not a valid date/time.');
    }
    // Same small grace window as ReservationService.createReservation's
    // past-time check — OrderService.createOrder itself doesn't enforce
    // this (a staff-recorded order may legitimately backdate `requiredAt`
    // for record-keeping), so it's this customer-facing layer's job.
    if (pickupTime <= new Date(Date.now() - 5 * 60 * 1000)) {
      throw new ConflictError('Pickup time cannot be in the past.');
    }
    return pickupTime;
  }

  /**
   * Rejects an order (pickup time for TAKEOUT, "right now" for DELIVERY)
   * outside the branch's configured hours, reusing `isBranchOpenNow`
   * (Phase 2) — it already handles "no hours configured" (treated as open,
   * not blocked) and overnight-crossing windows correctly for a single
   * instant, exactly what both checks need. Named `assertBranchOpenAt`
   * (was `assertPickupWithinBusinessHours` in Phase 4) now that it checks
   * two different kinds of instants.
   */
  private static async assertBranchOpenAt(organizationId: string, branchId: string, at: Date) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    if (!isBranchOpenNow(branch, at)) {
      throw new ConflictError('This restaurant is not accepting orders for the requested time.');
    }
  }

  /**
   * Resolves a DELIVERY order's plain-string `Order.deliveryAddress` —
   * the only address representation anywhere in the delivery pipeline
   * (`DeliveryOrder` itself has no address field; see this class's header
   * comment). `deliveryAddressId` (a saved CustomerAddress) takes priority
   * over freeform `deliveryAddress` when both happen to be sent; the
   * validation schema already requires at least one.
   */
  private static async resolveDeliveryAddress(
    customerId: string,
    input: CustomerCreateOrderInput,
  ): Promise<string> {
    if (input.deliveryAddressId) {
      const address = await prisma.customerAddress.findFirst({
        where: { id: input.deliveryAddressId, customerId },
      });
      if (!address) throw new NotFoundError('Delivery address');
      return this.formatAddress(address);
    }
    // Schema's refine already guarantees one of the two is present.
    return input.deliveryAddress!;
  }

  private static formatAddress(address: {
    label: string | null;
    line1: string;
    line2: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
  }): string {
    const parts = [address.line1, address.line2, address.city, address.province, address.postalCode].filter(
      (part): part is string => !!part,
    );
    return address.label ? `${address.label}: ${parts.join(', ')}` : parts.join(', ');
  }
}
