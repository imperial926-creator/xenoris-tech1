import 'server-only';
import { Prisma } from '@prisma/client';
import type { OrderStatus, TableStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { CustomerService } from '@/services/crm/CustomerService';
import { InventoryService } from '@/services/inventory/InventoryService';
import { AccountingService } from '@/services/accounting/AccountingService';
import { NotificationService } from '@/services/notifications/NotificationService';
import type {
  CreateOrderInput,
  ListOrdersQueryInput,
  RecordOrderPaymentInput,
  UpdateOrderStatusInput,
} from '@/lib/validation/order';

/** Same "whitelist, not anything goes" pattern as TableService/ReservationService. */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

// Table statuses a new dine-in order is allowed to seat itself onto,
// auto-transitioning the table to OCCUPIED. Mirrors (but does not import —
// TableService keeps its own transition map private) TableService's rule
// that OUT_OF_SERVICE/CLEANING tables aren't ready for a new party.
const TABLE_SEATABLE_STATUSES: TableStatus[] = ['AVAILABLE', 'RESERVED', 'WAITING'];
const TABLE_BLOCKED_STATUSES: TableStatus[] = ['OUT_OF_SERVICE', 'CLEANING'];

// Provisional standard PH VAT rate, applied only to MenuItem rows tagged
// taxCategory = 'STANDARD' (the field Phase 2 added for exactly this). Not
// yet reviewed by a licensed PH accountant for official invoicing — see
// docs/architecture.md § Risks. Kept as a single named constant (not
// scattered literals) so it is easy to find and revisit.
const PROVISIONAL_VAT_RATE = new Prisma.Decimal('0.12');

const ORDER_INCLUDE = {
  items: { include: { modifiers: true, menuItem: true, variant: true } },
  payments: true,
  table: true,
  delivery: { include: { deliveryZone: true, driver: true } },
} satisfies Prisma.OrderInclude;

export class OrderService {
  static async list(organizationId: string, branchId: string, query: ListOrdersQueryInput) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.order.findMany({
      where: { organizationId, branchId, status: query.status, type: query.type },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      // Phase 15 hardening: bounded (previously unbounded — see
      // docs/architecture.md § 23) so a branch with years of order history
      // can't return its entire order table (with full items/payments
      // includes) to the browser in one response.
      take: query.take,
      skip: query.skip,
    });
  }

  static async get(organizationId: string, branchId: string, orderId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, branchId, organizationId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundError('Order');
    return order;
  }

  static async getStatusHistory(organizationId: string, branchId: string, orderId: string) {
    await this.get(organizationId, branchId, orderId);
    return prisma.orderStatusHistory.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Sum of COMPLETED payments minus REFUNDED payments, and whether that
   * covers the order total. Computed on read, never stored — the order's
   * `payments` rows are the source of truth.
   */
  static paymentSummary(order: { total: Prisma.Decimal | string; payments: Array<{ amount: Prisma.Decimal | string; status: string }> }) {
    let paid = new Prisma.Decimal(0);
    for (const p of order.payments) {
      const amount = new Prisma.Decimal(p.amount as never);
      if (p.status === 'COMPLETED') paid = paid.plus(amount);
      else if (p.status === 'REFUNDED') paid = paid.minus(amount);
    }
    const total = new Prisma.Decimal(order.total as never);
    const balanceDue = total.minus(paid);
    return {
      paidAmount: paid.toFixed(2),
      balanceDue: balanceDue.toFixed(2),
      isFullyPaid: balanceDue.lte(0),
    };
  }

  /**
   * Creates an order with server-computed pricing. The client sends item
   * IDs, variant IDs, modifier IDs, and quantities only — every price comes
   * from the current menu, looked up here, never from the request body.
   * Item/modifier names and unit prices are snapshotted onto the created
   * rows so later menu edits never rewrite this order's history.
   */
  static async createOrder(
    organizationId: string,
    branchId: string,
    input: CreateOrderInput,
    actorUserId: string,
  ) {
    await this.assertBranchInOrg(organizationId, branchId);

    if (input.tableId) {
      // Existence/tenancy check only here — the status used to decide
      // whether to auto-seat is re-read fresh *inside* the transaction
      // below, not trusted from this earlier snapshot, so a concurrent
      // status change between this check and the transaction can't be
      // missed (same race-safety principle as Phase 3's reservations).
      const found = await prisma.restaurantTable.findFirst({
        where: { id: input.tableId, organizationId, branchId },
      });
      if (!found) throw new NotFoundError('Table');
    }
    if (input.reservationId) {
      const reservation = await prisma.reservation.findFirst({
        where: { id: input.reservationId, organizationId, branchId },
      });
      if (!reservation) throw new NotFoundError('Reservation');
    }
    if (input.customerUserId) {
      const customer = await prisma.user.findFirst({ where: { id: input.customerUserId, organizationId } });
      if (!customer) throw new NotFoundError('Customer account');
    }
    if (input.customerId) {
      await CustomerService.assertCustomerInOrg(organizationId, input.customerId);
    }

    // Phase 6: an optional delivery zone, whose CURRENT fee is snapshotted
    // onto both the order (so total/payments/invoices are correct — see
    // schema.prisma's Phase 6 comment) and the companion DeliveryOrder
    // created below. Not required — a delivery order can be placed without
    // a zone; deliveryFee simply stays 0 until one is assigned later.
    let deliveryFee = new Prisma.Decimal(0);
    if (input.deliveryZoneId) {
      const zone = await prisma.deliveryZone.findFirst({
        where: { id: input.deliveryZoneId, organizationId, branchId },
      });
      if (!zone) throw new NotFoundError('Delivery zone');
      if (!zone.active) throw new ConflictError(`Delivery zone "${zone.name}" is not currently active.`);
      deliveryFee = new Prisma.Decimal(zone.deliveryFee as never);
    }

    // Same parse-and-validate pattern as ReservationService.resolveWindow's
    // startAt — a loose string in, a real Date (or undefined) out.
    let requiredAt: Date | undefined;
    if (input.requiredAt) {
      requiredAt = new Date(input.requiredAt);
      if (Number.isNaN(requiredAt.getTime())) {
        throw new ConflictError('requiredAt is not a valid date/time.');
      }
    }

    const resolvedItems = await this.resolveAndPriceItems(organizationId, input.items);
    const totals = this.computeOrderTotals(resolvedItems, input.discountAmount, deliveryFee);

    let createdOrder;
    try {
      createdOrder = await prisma.$transaction(async (tx) => {
        if (input.type === 'DINE_IN' && input.tableId) {
          await this.seatTable(tx, organizationId, branchId, input.tableId);
        }

        const order = await tx.order.create({
          data: {
            organizationId,
            branchId,
            type: input.type,
            customerUserId: input.customerUserId,
            customerId: input.customerId,
            guestName: input.guestName,
            guestEmail: input.guestEmail,
            guestPhone: input.guestPhone,
            tableId: input.tableId,
            reservationId: input.reservationId,
            deliveryAddress: input.deliveryAddress,
            notes: input.notes,
            requiredAt,
            subtotal: totals.subtotal.toFixed(2),
            taxTotal: totals.taxTotal.toFixed(2),
            discountTotal: totals.discountTotal.toFixed(2),
            deliveryFee: totals.deliveryFee.toFixed(2),
            total: totals.total.toFixed(2),
          },
        });

        for (const item of resolvedItems) {
          const orderItem = await tx.orderItem.create({
            data: {
              orderId: order.id,
              menuItemId: item.menuItemId,
              menuItemVariantId: item.menuItemVariantId,
              nameSnapshot: item.nameSnapshot,
              unitPriceSnapshot: item.unitPrice.toFixed(2),
              quantity: item.quantity,
              lineSubtotal: item.lineSubtotal.toFixed(2),
              modifiersTotal: item.modifiersTotal.toFixed(2),
              lineTotal: item.lineTotal.toFixed(2),
              notes: item.notes,
            },
          });
          for (const modifier of item.modifiers) {
            await tx.orderItemModifier.create({
              data: {
                orderItemId: orderItem.id,
                modifierId: modifier.id,
                nameSnapshot: modifier.name,
                priceDeltaSnapshot: modifier.priceDelta.toFixed(2),
              },
            });
          }
        }

        await tx.orderStatusHistory.create({
          data: { orderId: order.id, fromStatus: null, toStatus: order.status, changedByUserId: actorUserId },
        });

        // Phase 6: a DELIVERY order always gets a companion DeliveryOrder,
        // created here in the same transaction as the order itself — see
        // schema.prisma's "Phase 6 — Delivery" comment for why this is a
        // separate 1:1 table rather than fields bolted onto Order.
        if (input.type === 'DELIVERY') {
          const deliveryOrder = await tx.deliveryOrder.create({
            data: {
              organizationId,
              branchId,
              orderId: order.id,
              deliveryZoneId: input.deliveryZoneId,
              deliveryFee: totals.deliveryFee.toFixed(2),
            },
          });
          await tx.deliveryStatusHistory.create({
            data: { deliveryOrderId: deliveryOrder.id, fromStatus: null, toStatus: deliveryOrder.status, changedByUserId: actorUserId },
          });
        }

        await writeAuditLog(tx, {
          organizationId,
          branchId,
          userId: actorUserId,
          action: 'order.create',
          entityType: 'Order',
          entityId: order.id,
          newValue: { ...order, itemCount: resolvedItems.length },
        });

        return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
      });
    } catch (error) {
      throw this.translateDbError(error);
    }

    // Phase 14 — Notifications. Fired after the transaction above has
    // already committed — see NotificationService's class header point 1.
    // "Order confirmation" fires at creation (unlike a reservation's
    // CONFIRMED-transition trigger — see ReservationService.updateStatus —
    // an order's "confirmation" is treated like a receipt/acknowledgment
    // of placement, not the internal CONFIRMED kitchen-side status).
    await NotificationService.sendOrderConfirmation(organizationId, branchId, createdOrder);
    return createdOrder;
  }

  static async updateStatus(
    organizationId: string,
    branchId: string,
    orderId: string,
    input: UpdateOrderStatusInput,
    actorUserId: string,
  ) {
    const order = await this.get(organizationId, branchId, orderId);
    if (order.status === input.status) return order;

    const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Cannot move order from ${order.status} to ${input.status}. Allowed next states: ${allowed.join(', ') || 'none'}.`,
      );
    }
    if (input.status === 'CANCELLED' && !input.cancellationReason) {
      throw new ConflictError('cancellationReason is required when cancelling an order.');
    }

    const result = await prisma.$transaction(async (tx) => {
      // Phase 15 hardening: guards against two concurrent "advance this
      // order's status" requests both reading the pre-transaction status
      // above and both entering this transaction — without the status in
      // the WHERE clause, the second one to commit would silently
      // overwrite the first's transition (and, worse, re-run the
      // COMPLETED-only inventory-consumption/revenue-posting side effects
      // below a second time). updateMany (not update) because {id, status}
      // isn't a unique-constraint shape Prisma's update() accepts; count
      // === 0 means another request already changed the status first.
      const updateResult = await tx.order.updateMany({
        where: { id: orderId, status: order.status },
        data: {
          status: input.status,
          cancellationReason: input.status === 'CANCELLED' ? input.cancellationReason : order.cancellationReason,
          cancelledAt: input.status === 'CANCELLED' ? new Date() : order.cancelledAt,
        },
      });
      if (updateResult.count === 0) {
        throw new ConflictError('Order status changed concurrently — reload and try again.');
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: input.status,
          changedByUserId: actorUserId,
          note: input.note,
        },
      });

      // Phase 9 — Inventory. A completed order is the point at which food
      // was actually served, so recipe-based ingredient consumption is
      // triggered here, not at order creation — a PENDING/CONFIRMED/etc.
      // order can still be CANCELLED, and COMPLETED is the one terminal
      // state that never reverses (see ALLOWED_TRANSITIONS above), so
      // there is never a need to "undo" a consumption that shouldn't have
      // happened. Runs inside this same transaction (one business event,
      // one transaction, matching Phase 6/7's Order→DeliveryOrder and
      // CateringQuote→CateringEvent side effects) and is best-effort —
      // see InventoryService.consumeForOrder for why it never blocks an
      // order from completing.
      if (input.status === 'COMPLETED') {
        const cogsAmount = await InventoryService.consumeForOrder(
          tx,
          organizationId,
          branchId,
          orderId,
          order.items.map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity })),
          actorUserId,
        );

        // Phase 10 — Accounting. Posts revenue (Cash/AR split by amount
        // actually paid so far, per-order-type revenue account, tax to
        // Taxes Payable) and COGS (using the exact consumption cost just
        // computed above) as two independent journal entries. Unlike
        // inventory consumption, this is NOT best-effort — see
        // AccountingService's class-level note on why financial postings
        // fail loudly rather than silently skipping.
        await AccountingService.recordOrderRevenue(
          tx,
          organizationId,
          branchId,
          {
            id: order.id,
            type: order.type,
            subtotal: order.subtotal,
            discountTotal: order.discountTotal,
            taxTotal: order.taxTotal,
            deliveryFee: order.deliveryFee,
            total: order.total,
          },
          cogsAmount,
          actorUserId,
        );
      }

      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'order.status_change',
        entityType: 'Order',
        entityId: orderId,
        previousValue: { status: order.status },
        newValue: { status: input.status, note: input.note, cancellationReason: input.cancellationReason },
      });

      return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE });
    });

    // Phase 14 — Notifications. Fired after the transaction above has
    // already committed — see NotificationService's class header point 1.
    // "Order status" fires on every transition; COMPLETED additionally
    // fires "Review request" per the master-spec §40 -> trigger-site
    // mapping documented on NotificationService.
    await NotificationService.sendOrderStatusUpdate(organizationId, branchId, result);
    if (input.status === 'COMPLETED') {
      await NotificationService.sendReviewRequest(organizationId, branchId, {
        ...result,
        relatedEntityType: 'Order',
        relatedEntityId: result.id,
        label: 'order',
      });
    }

    return result;
  }

  /**
   * Manually records a payment or refund against an order. No payment
   * gateway exists yet (see lib/payments/PaymentProvider.ts) — this is
   * staff attesting money changed hands, same pattern as
   * ReservationService.recordDeposit.
   */
  static async recordPayment(
    organizationId: string,
    branchId: string,
    orderId: string,
    input: RecordOrderPaymentInput,
    actorUserId: string,
  ) {
    const order = await this.get(organizationId, branchId, orderId);

    return prisma.$transaction(async (tx) => {
      const payment = await tx.orderPayment.create({
        data: {
          organizationId,
          orderId,
          method: input.method,
          amount: input.amount,
          status: input.status,
          note: input.note,
          recordedByUserId: actorUserId,
        },
      });

      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'order.payment_recorded',
        entityType: 'Order',
        entityId: orderId,
        newValue: payment,
      });

      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
    });
  }

  // --- pricing --------------------------------------------------------------

  private static async resolveAndPriceItems(organizationId: string, items: CreateOrderInput['items']) {
    const menuItemIds = [...new Set(items.map((i) => i.menuItemId))];
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, organizationId },
      include: {
        variants: true,
        modifierGroups: { include: { modifierGroup: { include: { modifiers: true } } } },
      },
    });
    // Explicit type argument works around a TS-compiler-in-this-sandbox
    // quirk (documented repeatedly in CLAUDE.md → Known Issues): a value
    // flowing through `any` (here, Prisma's types are unresolved because
    // node_modules doesn't exist in this build environment) into
    // `new Map(arr.map(...))` infers the value type as `unknown` instead of
    // the real element type. Same fix as AuthService's `roles` array and
    // prisma/seed.ts's `categoryByName` map.
    const menuItemById = new Map<string, (typeof menuItems)[number]>(menuItems.map((m) => [m.id, m]));

    return items.map((requested) => {
      const menuItem = menuItemById.get(requested.menuItemId);
      if (!menuItem) throw new NotFoundError(`Menu item ${requested.menuItemId}`);
      if (!menuItem.active || !menuItem.available) {
        throw new ConflictError(`"${menuItem.name}" is not currently available.`);
      }

      let unitPrice = new Prisma.Decimal(menuItem.price as never);
      let nameSnapshot = menuItem.name;
      if (requested.menuItemVariantId) {
        const variant = menuItem.variants.find((v) => v.id === requested.menuItemVariantId);
        if (!variant) throw new NotFoundError(`Variant ${requested.menuItemVariantId} on "${menuItem.name}"`);
        if (!variant.active) throw new ConflictError(`Variant "${variant.name}" is not currently available.`);
        unitPrice = new Prisma.Decimal(variant.price as never);
        nameSnapshot = `${menuItem.name} (${variant.name})`;
      }

      // Every modifier requested must belong to a group actually linked to
      // this item — a client cannot bolt an unrelated modifier onto a line.
      const linkedGroups = menuItem.modifierGroups.map((link) => link.modifierGroup);
      const allowedModifierIds = new Set(linkedGroups.flatMap((g) => g.modifiers.map((m) => m.id)));
      const selectedModifiers = requested.modifierIds.map((id) => {
        const found = linkedGroups.flatMap((g) => g.modifiers).find((m) => m.id === id);
        if (!found || !allowedModifierIds.has(id)) {
          throw new ConflictError(`Modifier ${id} is not available on "${menuItem.name}".`);
        }
        if (!found.active) throw new ConflictError(`Modifier "${found.name}" is not currently available.`);
        return found;
      });

      // Enforce each linked group's required/minSelect/maxSelect against
      // what was actually selected for this line — the whole reason
      // MenuModifierGroup exists (see docs/database.md).
      for (const group of linkedGroups) {
        const selectedInGroup = selectedModifiers.filter((m) => m.modifierGroupId === group.id);
        if (group.required && selectedInGroup.length < Math.max(group.minSelect, 1)) {
          throw new ConflictError(`"${group.name}" requires at least ${Math.max(group.minSelect, 1)} selection(s) on "${menuItem.name}".`);
        }
        if (selectedInGroup.length < group.minSelect) {
          throw new ConflictError(`"${group.name}" requires at least ${group.minSelect} selection(s) on "${menuItem.name}".`);
        }
        if (selectedInGroup.length > group.maxSelect) {
          throw new ConflictError(`"${group.name}" allows at most ${group.maxSelect} selection(s) on "${menuItem.name}".`);
        }
      }

      const modifierUnitTotal = selectedModifiers.reduce(
        (sum, m) => sum.plus(new Prisma.Decimal(m.priceDelta as never)),
        new Prisma.Decimal(0),
      );
      const quantity = new Prisma.Decimal(requested.quantity);
      const lineSubtotal = unitPrice.times(quantity);
      const modifiersTotal = modifierUnitTotal.times(quantity);
      const lineTotal = lineSubtotal.plus(modifiersTotal);

      return {
        menuItemId: menuItem.id,
        menuItemVariantId: requested.menuItemVariantId,
        nameSnapshot,
        unitPrice,
        quantity: requested.quantity,
        notes: requested.notes,
        taxCategory: menuItem.taxCategory,
        modifiers: selectedModifiers,
        lineSubtotal,
        modifiersTotal,
        lineTotal,
      };
    });
  }

  private static computeOrderTotals(
    resolvedItems: Array<{ lineTotal: Prisma.Decimal; taxCategory: string }>,
    discountAmountInput: string,
    deliveryFee: Prisma.Decimal = new Prisma.Decimal(0),
  ) {
    const subtotal = resolvedItems.reduce((sum, i) => sum.plus(i.lineTotal), new Prisma.Decimal(0));
    const taxableBase = resolvedItems
      .filter((i) => i.taxCategory === 'STANDARD')
      .reduce((sum, i) => sum.plus(i.lineTotal), new Prisma.Decimal(0));
    const taxTotal = taxableBase.times(PROVISIONAL_VAT_RATE);
    const discountTotal = new Prisma.Decimal(discountAmountInput);
    // Phase 15 hardening: discountAmountSchema only enforced non-negative,
    // so an oversized discount (e.g. a fat-fingered ₱10,000 off a ₱500
    // order) previously produced a negative order.total, which then
    // silently skipped/underposted revenue in AccountingService.
    // recordOrderRevenue instead of surfacing a clear error at order-create
    // time.
    if (discountTotal.greaterThan(subtotal)) {
      throw new ConflictError('discountAmount cannot exceed the order subtotal.');
    }
    // Delivery fee is not part of the taxable food subtotal — it's added
    // straight into the total the customer owes (see schema.prisma's
    // Phase 6 comment for why it's snapshotted here at all).
    const total = subtotal.minus(discountTotal).plus(taxTotal).plus(deliveryFee);
    return { subtotal, taxTotal, discountTotal, deliveryFee, total };
  }

  // --- table integration ------------------------------------------------

  /**
   * Best-effort seating: a new dine-in order at a table already AVAILABLE/
   * RESERVED/WAITING flips it to OCCUPIED (and records the transition in
   * table_status_history, same as a manual change on the Tables board).
   * A table already OCCUPIED is left as-is (this is an additional order for
   * an already-seated party, not an error). OUT_OF_SERVICE/CLEANING tables
   * reject the order outright — see OrderService's module header.
   *
   * Deliberately does NOT reverse the transition when the order completes
   * or cancels — table state stays under staff control via the Tables
   * board, same boundary Phase 3 drew between reservation and table status.
   */
  private static async seatTable(tx: Prisma.TransactionClient, organizationId: string, branchId: string, tableId: string) {
    // Fresh read inside the transaction — not the pre-transaction snapshot
    // — so a concurrent status change is never missed under Read Committed
    // isolation (Postgres's default, which Prisma uses unless overridden).
    // Phase 15 hardening: scoped by organizationId/branchId (previously a
    // bare findUniqueOrThrow by id) — createOrder already validates table
    // ownership once before this transaction opens, so this was not an
    // exploitable IDOR today, but every table read/write in this codebase
    // is expected to carry its own tenant scope rather than trust an
    // earlier check alone.
    const table = await tx.restaurantTable.findFirstOrThrow({ where: { id: tableId, organizationId, branchId } });
    if (TABLE_BLOCKED_STATUSES.includes(table.status)) {
      throw new ConflictError(`Table is ${table.status.replace(/_/g, ' ').toLowerCase()} and cannot be seated.`);
    }
    if (!TABLE_SEATABLE_STATUSES.includes(table.status)) {
      return; // Already OCCUPIED — nothing to do.
    }
    await tx.restaurantTable.update({ where: { id: table.id }, data: { status: 'OCCUPIED' } });
    await tx.tableStatusHistory.create({
      data: {
        tableId: table.id,
        fromStatus: table.status,
        toStatus: 'OCCUPIED',
        note: 'Auto-transitioned by new dine-in order.',
      },
    });
  }

  // --- helpers ------------------------------------------------------------

  private static async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }

  private static translateDbError(error: unknown): unknown {
    if (error instanceof NotFoundError || error instanceof ConflictError) return error;
    if (error instanceof Error && /Restrict|foreign key/i.test(error.message)) {
      return new ConflictError('One or more referenced menu items could not be used for this order.');
    }
    return error;
  }
}
