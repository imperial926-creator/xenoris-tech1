import 'server-only';
import type { DeliveryStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { DriverService } from '@/services/delivery/DriverService';
import { NotificationService } from '@/services/notifications/NotificationService';
import { emitRealtimeEvent, resolveEventCustomerAccountId } from '@/lib/realtime/emit';
import type { AssignDriverInput, ListDeliveriesQueryInput, UpdateDeliveryStatusInput } from '@/lib/validation/delivery';

/**
 * Own state machine, deliberately NOT shared with OrderStatus — see the
 * "Phase 6 — Delivery" comment block in schema.prisma for the full
 * reasoning (dispatch progress and kitchen progress are different axes).
 *
 * FAILED -> ASSIGNED (a retry, reassigning to a driver) is intentionally
 * routed through `assignDriver`, not this whitelist — assigning always
 * needs a driverId, so it has its own entry point and its own audit trail
 * (DriverAssignment), same as OrderService keeps "seat a table" out of its
 * generic status whitelist.
 */
const ALLOWED_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  UNASSIGNED: ['CANCELLED'],
  ASSIGNED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['DELIVERED', 'FAILED', 'CANCELLED'],
  DELIVERED: [],
  FAILED: ['CANCELLED'],
  CANCELLED: [],
};

// (Re)assignment is allowed from these states only — not from PICKED_UP
// onward, where a driver already has the order physically in hand; a
// mid-transit handoff is a reasonable future feature, not built here.
const ASSIGNABLE_FROM: DeliveryStatus[] = ['UNASSIGNED', 'ASSIGNED', 'FAILED'];

// CAPP Phase 7 — spec § 43. Only these two DeliveryOrder.status transitions
// have a named real-time event.
const DELIVERY_STATUS_EVENT: Partial<Record<DeliveryStatus, 'OrderOutForDelivery' | 'OrderDelivered'>> = {
  PICKED_UP: 'OrderOutForDelivery',
  DELIVERED: 'OrderDelivered',
};

const DELIVERY_INCLUDE = {
  // `payments` included so callers (the driver interface especially — see
  // master spec §19's "Payment Status" field) can show whether the order is
  // paid without a second round-trip to the orders API.
  order: { include: { items: true, payments: true } },
  deliveryZone: true,
  driver: { include: { user: { select: { firstName: true, lastName: true, phone: true } } } },
} satisfies Prisma.DeliveryOrderInclude;

export class DeliveryService {
  static async list(organizationId: string, branchId: string, query: ListDeliveriesQueryInput) {
    await this.assertBranchInOrg(organizationId, branchId);
    // Phase 15 hardening: bounded (previously unbounded — see
    // docs/architecture.md § 23).
    return prisma.deliveryOrder.findMany({
      where: { organizationId, branchId, status: query.status },
      include: DELIVERY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
    });
  }

  static async get(organizationId: string, branchId: string, deliveryOrderId: string) {
    const delivery = await prisma.deliveryOrder.findFirst({
      where: { id: deliveryOrderId, branchId, organizationId },
      include: DELIVERY_INCLUDE,
    });
    if (!delivery) throw new NotFoundError('Delivery');
    return delivery;
  }

  static async getStatusHistory(organizationId: string, branchId: string, deliveryOrderId: string) {
    await this.get(organizationId, branchId, deliveryOrderId);
    return prisma.deliveryStatusHistory.findMany({
      where: { deliveryOrderId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * The driver-facing view (master spec §19): only deliveries assigned to
   * the CALLING driver's own profile, ever — never another driver's, and
   * never the full branch queue. `organizationId`/`userId` come from the
   * session, not from client-supplied params, so a driver cannot request
   * another driver's deliveries by guessing an ID.
   */
  static async myDeliveries(organizationId: string, userId: string) {
    const driver = await DriverService.getByUserId(organizationId, userId);
    return prisma.deliveryOrder.findMany({
      where: { organizationId, driverId: driver.id },
      include: DELIVERY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Assigns (or reassigns) a driver. Closes out any currently-open
   * DriverAssignment row and opens a new one — the audit trail this method
   * exists for, separate from DeliveryOrder.driverId's "current value"
   * pointer (see schema.prisma comment #4).
   */
  static async assignDriver(
    organizationId: string,
    branchId: string,
    deliveryOrderId: string,
    input: AssignDriverInput,
    actorUserId: string,
  ) {
    const delivery = await this.get(organizationId, branchId, deliveryOrderId);
    if (!ASSIGNABLE_FROM.includes(delivery.status)) {
      throw new ConflictError(
        `Cannot assign a driver while delivery is ${delivery.status}. Assignment is only possible from ${ASSIGNABLE_FROM.join('/')}.`,
      );
    }
    if (delivery.driverId === input.driverId) {
      throw new ConflictError('This delivery is already assigned to this driver.');
    }

    const driver = await prisma.driver.findFirst({ where: { id: input.driverId, organizationId, branchId } });
    if (!driver) throw new NotFoundError('Driver');
    if (!driver.active) throw new ConflictError(`Driver "${driver.id}" is not currently active.`);

    return prisma.$transaction(async (tx) => {
      if (delivery.driverId) {
        await tx.driverAssignment.updateMany({
          where: { deliveryOrderId, driverId: delivery.driverId, unassignedAt: null },
          data: { unassignedAt: new Date() },
        });
      }
      await tx.driverAssignment.create({
        data: {
          deliveryOrderId,
          driverId: driver.id,
          assignedByUserId: actorUserId,
          note: input.note,
        },
      });

      const updated = await tx.deliveryOrder.update({
        where: { id: deliveryOrderId },
        data: { driverId: driver.id, status: 'ASSIGNED' },
      });

      await tx.deliveryStatusHistory.create({
        data: {
          deliveryOrderId,
          fromStatus: delivery.status,
          toStatus: 'ASSIGNED',
          changedByUserId: actorUserId,
          note: input.note,
        },
      });

      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'delivery.assign_driver',
        entityType: 'DeliveryOrder',
        entityId: deliveryOrderId,
        previousValue: { driverId: delivery.driverId, status: delivery.status },
        newValue: { driverId: driver.id, status: updated.status },
      });

      return tx.deliveryOrder.findUniqueOrThrow({ where: { id: deliveryOrderId }, include: DELIVERY_INCLUDE });
    });
  }

  static async updateStatus(
    organizationId: string,
    branchId: string,
    deliveryOrderId: string,
    input: UpdateDeliveryStatusInput,
    actorUserId: string,
  ) {
    const delivery = await this.get(organizationId, branchId, deliveryOrderId);
    if (delivery.status === input.status) return delivery;

    const allowed = ALLOWED_TRANSITIONS[delivery.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Cannot move delivery from ${delivery.status} to ${input.status}. Allowed next states: ${allowed.join(', ') || 'none'}.`,
      );
    }
    if (input.status === 'PICKED_UP' && !delivery.driverId) {
      throw new ConflictError('Cannot mark PICKED_UP before a driver is assigned.');
    }
    if ((input.status === 'CANCELLED' || input.status === 'FAILED') && !input.note) {
      throw new ConflictError(`note is required when marking a delivery ${input.status}.`);
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.deliveryOrder.update({
        where: { id: deliveryOrderId },
        data: {
          status: input.status,
          pickedUpAt: input.status === 'PICKED_UP' ? new Date() : delivery.pickedUpAt,
          deliveredAt: input.status === 'DELIVERED' ? new Date() : delivery.deliveredAt,
          proofOfDeliveryNote: input.status === 'DELIVERED' ? input.proofOfDeliveryNote : delivery.proofOfDeliveryNote,
          recipientName: input.status === 'DELIVERED' ? input.recipientName : delivery.recipientName,
        },
      });

      await tx.deliveryStatusHistory.create({
        data: {
          deliveryOrderId,
          fromStatus: delivery.status,
          toStatus: input.status,
          changedByUserId: actorUserId,
          note: input.note,
        },
      });

      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'delivery.status_change',
        entityType: 'DeliveryOrder',
        entityId: deliveryOrderId,
        previousValue: { status: delivery.status },
        newValue: { status: input.status, note: input.note },
      });

      // CAPP Phase 7 — spec § 43 (see DELIVERY_STATUS_EVENT above; this is
      // DeliveryOrder.status, not Order.status — see this file's own
      // ALLOWED_TRANSITIONS comment on why the two are deliberately
      // separate state machines).
      const eventType = DELIVERY_STATUS_EVENT[input.status];
      if (eventType) {
        await emitRealtimeEvent(tx, {
          organizationId,
          type: eventType,
          customerAccountId: await resolveEventCustomerAccountId(tx, delivery.order.customerId),
          payload: { deliveryOrderId, orderId: delivery.orderId, branchId, status: input.status },
          // CAPP Phase 9 — spec § 27 Notification Center.
          notification: {
            category: 'ORDER',
            title: eventType === 'OrderOutForDelivery' ? 'Order out for delivery' : 'Order delivered',
            message:
              eventType === 'OrderOutForDelivery'
                ? 'Your order is on its way.'
                : 'Your order has been delivered. Enjoy!',
            deepLink: 'Orders',
            relatedEntityType: 'Order',
            relatedEntityId: delivery.orderId,
          },
        });
      }

      return tx.deliveryOrder.findUniqueOrThrow({ where: { id: updated.id }, include: DELIVERY_INCLUDE });
    });

    // Phase 14 — Notifications. Fired after the transaction above has
    // already committed — see NotificationService's class header point 1.
    // "Delivery updates" fires on every transition; recipient sourced from
    // result.order, since DELIVERY_INCLUDE already includes it.
    await NotificationService.sendDeliveryUpdate(organizationId, branchId, result);

    return result;
  }

  private static async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }
}
