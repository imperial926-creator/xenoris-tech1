import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { classifySegment, resolveRfmThresholds, type CustomerSegment } from '@/lib/crm/rfm';
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
  CreateCustomerAddressInput,
  UpdateCustomerAddressInput,
  SetCustomerPreferenceInput,
  CreateCustomerReviewInput,
  ListCustomersQueryInput,
} from '@/lib/validation/crm';

const PROFILE_INCLUDE = {
  addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
  preferences: { orderBy: { key: 'asc' } },
  notes: { orderBy: { createdAt: 'desc' } },
  tags: { orderBy: { tag: 'asc' } },
  reviews: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.CustomerInclude;

// Order statuses/catering event statuses excluded from spend/frequency —
// a cancelled order was never actually fulfilled, so it shouldn't count
// toward a customer's history any more than it counts toward branch revenue.
const EXCLUDED_ORDER_STATUS: Prisma.OrderWhereInput['status'] = { not: 'CANCELLED' };
const EXCLUDED_EVENT_STATUS: Prisma.CateringEventWhereInput['status'] = { not: 'CANCELLED' };

export class CustomerService {
  // --- profile CRUD --------------------------------------------------------

  static async list(organizationId: string, query: ListCustomersQueryInput) {
    const where: Prisma.CustomerWhereInput = { organizationId };
    if (query.status) where.status = query.status;
    if (query.search) {
      const s = query.search;
      where.OR = [
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
      ];
    }
    return prisma.customer.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  static async get(organizationId: string, customerId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      include: PROFILE_INCLUDE,
    });
    if (!customer) throw new NotFoundError('Customer');
    return customer;
  }

  /**
   * Existence + tenancy check used both by this service's own CRUD and by
   * OrderService/ReservationService/CateringService when a caller supplies
   * a customerId — the one point of truth for "does this Customer belong
   * to this organization."
   */
  static async assertCustomerInOrg(organizationId: string, customerId: string) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) throw new NotFoundError('Customer');
    return customer;
  }

  static async create(organizationId: string, input: CreateCustomerInput, actorUserId: string) {
    if (input.userId) {
      const user = await prisma.user.findFirst({ where: { id: input.userId, organizationId } });
      if (!user) throw new NotFoundError('User account');
      const existingProfile = await prisma.customer.findUnique({ where: { userId: input.userId } });
      if (existingProfile) throw new ConflictError('This user account already has a customer profile.');
    }
    const dateOfBirth = input.dateOfBirth ? this.parseDate(input.dateOfBirth, 'dateOfBirth') : undefined;

    return prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          organizationId,
          userId: input.userId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          dateOfBirth,
        },
      });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'customer.create', entityType: 'Customer', entityId: customer.id, newValue: customer,
      });
      return customer;
    });
  }

  static async update(organizationId: string, customerId: string, input: UpdateCustomerInput, actorUserId: string) {
    const existing = await this.assertCustomerInOrg(organizationId, customerId);
    const dateOfBirth = input.dateOfBirth ? this.parseDate(input.dateOfBirth, 'dateOfBirth') : undefined;

    return prisma.$transaction(async (tx) => {
      const customer = await tx.customer.update({
        where: { id: customerId },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          status: input.status,
          dateOfBirth,
        },
      });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'customer.update', entityType: 'Customer', entityId: customer.id,
        previousValue: existing, newValue: customer,
      });
      return customer;
    });
  }

  // --- addresses -------------------------------------------------------------

  static async addAddress(
    organizationId: string,
    customerId: string,
    input: CreateCustomerAddressInput,
    actorUserId: string,
  ) {
    await this.assertCustomerInOrg(organizationId, customerId);
    return prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.customerAddress.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
      }
      const address = await tx.customerAddress.create({ data: { customerId, ...input } });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'customer_address.create', entityType: 'CustomerAddress', entityId: address.id, newValue: address,
      });
      return address;
    });
  }

  static async updateAddress(
    organizationId: string,
    customerId: string,
    addressId: string,
    input: UpdateCustomerAddressInput,
    actorUserId: string,
  ) {
    await this.assertCustomerInOrg(organizationId, customerId);
    const existing = await prisma.customerAddress.findFirst({ where: { id: addressId, customerId } });
    if (!existing) throw new NotFoundError('Customer address');

    return prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true, NOT: { id: addressId } },
          data: { isDefault: false },
        });
      }
      const address = await tx.customerAddress.update({ where: { id: addressId }, data: input });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'customer_address.update', entityType: 'CustomerAddress', entityId: address.id,
        previousValue: existing, newValue: address,
      });
      return address;
    });
  }

  static async deleteAddress(organizationId: string, customerId: string, addressId: string, actorUserId: string) {
    await this.assertCustomerInOrg(organizationId, customerId);
    const existing = await prisma.customerAddress.findFirst({ where: { id: addressId, customerId } });
    if (!existing) throw new NotFoundError('Customer address');

    return prisma.$transaction(async (tx) => {
      await tx.customerAddress.delete({ where: { id: addressId } });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'customer_address.delete', entityType: 'CustomerAddress', entityId: addressId, previousValue: existing,
      });
      return { id: addressId };
    });
  }

  // --- preferences -------------------------------------------------------------

  static async setPreference(
    organizationId: string,
    customerId: string,
    input: SetCustomerPreferenceInput,
    actorUserId: string,
  ) {
    await this.assertCustomerInOrg(organizationId, customerId);
    return prisma.$transaction(async (tx) => {
      const preference = await tx.customerPreference.upsert({
        where: { customerId_key: { customerId, key: input.key } },
        create: { customerId, key: input.key, value: input.value },
        update: { value: input.value },
      });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'customer_preference.set', entityType: 'CustomerPreference', entityId: preference.id, newValue: preference,
      });
      return preference;
    });
  }

  static async removePreference(organizationId: string, customerId: string, key: string, actorUserId: string) {
    await this.assertCustomerInOrg(organizationId, customerId);
    const existing = await prisma.customerPreference.findUnique({ where: { customerId_key: { customerId, key } } });
    if (!existing) throw new NotFoundError('Customer preference');

    return prisma.$transaction(async (tx) => {
      await tx.customerPreference.delete({ where: { id: existing.id } });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'customer_preference.remove', entityType: 'CustomerPreference', entityId: existing.id, previousValue: existing,
      });
      return { key };
    });
  }

  // --- notes / tags -------------------------------------------------------------

  static async addNote(organizationId: string, customerId: string, note: string, actorUserId: string) {
    await this.assertCustomerInOrg(organizationId, customerId);
    return prisma.$transaction(async (tx) => {
      const created = await tx.customerNote.create({ data: { customerId, authorUserId: actorUserId, note } });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'customer_note.create', entityType: 'CustomerNote', entityId: created.id, newValue: created,
      });
      return created;
    });
  }

  static async addTag(organizationId: string, customerId: string, tag: string, actorUserId: string) {
    await this.assertCustomerInOrg(organizationId, customerId);
    const existing = await prisma.customerTag.findUnique({ where: { customerId_tag: { customerId, tag } } });
    if (existing) throw new ConflictError(`Tag "${tag}" is already applied to this customer.`);

    return prisma.$transaction(async (tx) => {
      const created = await tx.customerTag.create({ data: { customerId, tag, createdByUserId: actorUserId } });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'customer_tag.create', entityType: 'CustomerTag', entityId: created.id, newValue: created,
      });
      return created;
    });
  }

  static async removeTag(organizationId: string, customerId: string, tag: string, actorUserId: string) {
    await this.assertCustomerInOrg(organizationId, customerId);
    const existing = await prisma.customerTag.findUnique({ where: { customerId_tag: { customerId, tag } } });
    if (!existing) throw new NotFoundError('Customer tag');

    return prisma.$transaction(async (tx) => {
      await tx.customerTag.delete({ where: { id: existing.id } });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'customer_tag.remove', entityType: 'CustomerTag', entityId: existing.id, previousValue: existing,
      });
      return { tag };
    });
  }

  // --- reviews -------------------------------------------------------------

  static async addReview(organizationId: string, input: CreateCustomerReviewInput, actorUserId: string) {
    if (input.customerId) await this.assertCustomerInOrg(organizationId, input.customerId);
    if (input.branchId) {
      const branch = await prisma.branch.findFirst({ where: { id: input.branchId, organizationId } });
      if (!branch) throw new NotFoundError('Branch');
    }
    if (input.orderId) {
      const order = await prisma.order.findFirst({ where: { id: input.orderId, organizationId } });
      if (!order) throw new NotFoundError('Order');
    }
    if (input.reservationId) {
      const reservation = await prisma.reservation.findFirst({ where: { id: input.reservationId, organizationId } });
      if (!reservation) throw new NotFoundError('Reservation');
    }
    if (input.cateringEventId) {
      const event = await prisma.cateringEvent.findFirst({ where: { id: input.cateringEventId, organizationId } });
      if (!event) throw new NotFoundError('Catering event');
    }

    return prisma.$transaction(async (tx) => {
      const review = await tx.customerReview.create({
        data: {
          organizationId,
          branchId: input.branchId,
          customerId: input.customerId,
          orderId: input.orderId,
          reservationId: input.reservationId,
          cateringEventId: input.cateringEventId,
          rating: input.rating,
          comment: input.comment,
          recordedByUserId: actorUserId,
        },
      });
      await writeAuditLog(tx, {
        organizationId, branchId: input.branchId, userId: actorUserId,
        action: 'customer_review.create', entityType: 'CustomerReview', entityId: review.id, newValue: review,
      });
      return review;
    });
  }

  static async listReviews(organizationId: string, customerId: string) {
    await this.assertCustomerInOrg(organizationId, customerId);
    return prisma.customerReview.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
  }

  // --- analytics / RFM -------------------------------------------------------------

  /**
   * Master spec §31's tracked metrics plus §32's RFM segment, all computed
   * live from Order/Reservation/CateringEvent — see schema.prisma's
   * "Phase 8 — CRM" comment block (#4) for why this is never a stored,
   * potentially-stale column.
   */
  static async getAnalytics(organizationId: string, customerId: string) {
    await this.assertCustomerInOrg(organizationId, customerId);

    const [orderStats, reservationCount, cateringEvents, favoriteItemsRaw, org] = await Promise.all([
      prisma.order.aggregate({
        where: { organizationId, customerId, status: EXCLUDED_ORDER_STATUS },
        _sum: { total: true },
        _count: true,
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      prisma.reservation.count({
        where: { organizationId, customerId, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
      }),
      prisma.cateringEvent.findMany({
        where: { organizationId, customerId, status: EXCLUDED_EVENT_STATUS },
        select: { total: true, createdAt: true },
      }),
      prisma.orderItem.groupBy({
        by: ['menuItemId'],
        where: { order: { organizationId, customerId, status: EXCLUDED_ORDER_STATUS } },
        _sum: { quantity: true },
        _max: { nameSnapshot: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { crmSettings: true } }),
    ]);

    const totalOrders = orderStats._count;
    const totalCateringOrders = cateringEvents.length;
    const orderSpend = new Prisma.Decimal(orderStats._sum.total ?? 0);
    const cateringSpend = cateringEvents.reduce(
      (sum, event) => sum.plus(new Prisma.Decimal(event.total as never)),
      new Prisma.Decimal(0),
    );
    const totalSpending = orderSpend.plus(cateringSpend);
    // Frequency for RFM purposes counts revenue-bearing transactions
    // (orders + catering events); a reservation with no linked order isn't
    // itself a monetary transaction, so it's tracked (totalReservations)
    // but excluded from the frequency/monetary axes.
    const frequency = totalOrders + totalCateringOrders;
    const averageOrderValue = totalOrders > 0 ? orderSpend.dividedBy(totalOrders) : new Prisma.Decimal(0);

    const transactionDates = [
      orderStats._min.createdAt,
      orderStats._max.createdAt,
      ...cateringEvents.map((event) => event.createdAt),
    ].filter((date): date is Date => date != null);
    const firstTransactionAt =
      transactionDates.length > 0 ? new Date(Math.min(...transactionDates.map((d) => d.getTime()))) : null;
    const lastTransactionAt =
      transactionDates.length > 0 ? new Date(Math.max(...transactionDates.map((d) => d.getTime()))) : null;

    let visitFrequencyDays: number | null = null;
    if (firstTransactionAt && lastTransactionAt && frequency > 1) {
      const spanDays = (lastTransactionAt.getTime() - firstTransactionAt.getTime()) / (1000 * 60 * 60 * 24);
      visitFrequencyDays = Math.round((spanDays / (frequency - 1)) * 10) / 10;
    }

    const recencyDays =
      lastTransactionAt !== null
        ? Math.floor((Date.now() - lastTransactionAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;

    const thresholds = resolveRfmThresholds(org?.crmSettings ?? null);
    const segment: CustomerSegment = classifySegment(
      { recencyDays, frequency, monetary: totalSpending.toFixed(2) },
      thresholds,
    );

    return {
      customerId,
      totalOrders,
      totalReservations: reservationCount,
      totalCateringOrders,
      totalSpending: totalSpending.toFixed(2),
      averageOrderValue: averageOrderValue.toFixed(2),
      firstTransactionAt,
      lastTransactionAt,
      visitFrequencyDays,
      favoriteProducts: favoriteItemsRaw.map((row) => ({
        menuItemId: row.menuItemId,
        name: row._max.nameSnapshot ?? 'Unknown item',
        quantity: row._sum.quantity ?? 0,
      })),
      rfm: { recencyDays, frequency, monetary: totalSpending.toFixed(2), segment },
    };
  }

  /**
   * Segment counts across every customer in the organization, for the CRM
   * dashboard's summary cards. Runs getAnalytics per customer rather than a
   * single aggregated query — an N+1 pattern that is fine at this build's
   * demo/early-stage data volumes but is a known scaling limit, honestly
   * flagged rather than silently accepted: a real production deployment
   * with thousands of customers would need a materialized/batched version
   * of this instead.
   */
  static async segmentBreakdown(organizationId: string): Promise<Record<CustomerSegment, number>> {
    const customers = await prisma.customer.findMany({ where: { organizationId }, select: { id: true } });
    const counts: Record<CustomerSegment, number> = {
      NEW: 0, RETURNING: 0, REGULAR: 0, VIP: 0, AT_RISK: 0, INACTIVE: 0, HIGH_VALUE: 0,
    };
    for (const customer of customers) {
      const analytics = await this.getAnalytics(organizationId, customer.id);
      counts[analytics.rfm.segment] += 1;
    }
    return counts;
  }

  private static parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ConflictError(`${field} is not a valid date.`);
    return date;
  }
}
