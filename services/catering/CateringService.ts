import 'server-only';
import { Prisma } from '@prisma/client';
import type { CateringEventStatus, CateringQuoteStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { CustomerService } from '@/services/crm/CustomerService';
import { AccountingService } from '@/services/accounting/AccountingService';
import type {
  CreateCateringPackageInput,
  UpdateCateringPackageInput,
  CreateCateringInquiryInput,
  UpdateCateringInquiryInput,
  CreateCateringQuoteInput,
  UpdateCateringQuoteInput,
  UpdateCateringQuoteStatusInput,
  UpdateCateringEventStatusInput,
  RecordCateringPaymentInput,
  ListCateringInquiriesQueryInput,
  ListCateringQuotesQueryInput,
  ListCateringEventsQueryInput,
} from '@/lib/validation/catering';

// Provisional standard PH VAT rate — same value and same "not yet reviewed
// by a licensed PH accountant" caveat as OrderService.PROVISIONAL_VAT_RATE.
// Kept as its own local constant rather than shared, matching this
// codebase's established "small validation/pricing constants stay local to
// their own service" convention (see lib/validation/delivery.ts's moneyString
// comment for the same reasoning applied to a different constant).
const PROVISIONAL_VAT_RATE = new Prisma.Decimal('0.12');

/** Quote status whitelist — mirrors OrderService/DeliveryService's pattern. */
const QUOTE_ALLOWED_TRANSITIONS: Record<CateringQuoteStatus, CateringQuoteStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  VIEWED: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

/** Event status whitelist. */
const EVENT_ALLOWED_TRANSITIONS: Record<CateringEventStatus, CateringEventStatus[]> = {
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const QUOTE_INCLUDE = {
  items: true,
  inquiry: true,
  package: true,
  event: { include: { items: true, payments: true } },
} satisfies Prisma.CateringQuoteInclude;

const EVENT_INCLUDE = {
  items: true,
  payments: true,
  quote: { include: { inquiry: true } },
} satisfies Prisma.CateringEventInclude;

export class CateringService {
  // --- packages --------------------------------------------------------------

  static async listPackages(organizationId: string, branchId: string) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.cateringPackage.findMany({ where: { branchId }, orderBy: { name: 'asc' } });
  }

  static async getPackage(organizationId: string, branchId: string, packageId: string) {
    const pkg = await prisma.cateringPackage.findFirst({ where: { id: packageId, branchId, organizationId } });
    if (!pkg) throw new NotFoundError('Catering package');
    return pkg;
  }

  static async createPackage(
    organizationId: string,
    branchId: string,
    input: CreateCateringPackageInput,
    actorUserId: string,
  ) {
    await this.assertBranchInOrg(organizationId, branchId);
    const existing = await prisma.cateringPackage.findUnique({
      where: { branchId_name: { branchId, name: input.name } },
    });
    if (existing) throw new ConflictError(`A catering package named "${input.name}" already exists at this branch.`);

    return prisma.$transaction(async (tx) => {
      const pkg = await tx.cateringPackage.create({
        data: {
          organizationId,
          branchId,
          name: input.name,
          description: input.description,
          pricePerGuest: input.pricePerGuest,
          minGuests: input.minGuests,
          maxGuests: input.maxGuests,
        },
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'catering_package.create', entityType: 'CateringPackage', entityId: pkg.id, newValue: pkg,
      });
      return pkg;
    });
  }

  static async updatePackage(
    organizationId: string,
    branchId: string,
    packageId: string,
    input: UpdateCateringPackageInput,
    actorUserId: string,
  ) {
    const existing = await this.getPackage(organizationId, branchId, packageId);
    return prisma.$transaction(async (tx) => {
      const pkg = await tx.cateringPackage.update({ where: { id: packageId }, data: input });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'catering_package.update', entityType: 'CateringPackage', entityId: pkg.id,
        previousValue: existing, newValue: pkg,
      });
      return pkg;
    });
  }

  // --- inquiries ---------------------------------------------------------------

  static async listInquiries(organizationId: string, branchId: string, query: ListCateringInquiriesQueryInput) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.cateringInquiry.findMany({
      where: { organizationId, branchId, status: query.status },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getInquiry(organizationId: string, branchId: string, inquiryId: string) {
    const inquiry = await prisma.cateringInquiry.findFirst({
      where: { id: inquiryId, branchId, organizationId },
      include: { quotes: { orderBy: { createdAt: 'desc' } } },
    });
    if (!inquiry) throw new NotFoundError('Catering inquiry');
    return inquiry;
  }

  static async createInquiry(
    organizationId: string,
    branchId: string,
    input: CreateCateringInquiryInput,
    actorUserId: string,
  ) {
    await this.assertBranchInOrg(organizationId, branchId);
    if (input.customerUserId) {
      const customer = await prisma.user.findFirst({ where: { id: input.customerUserId, organizationId } });
      if (!customer) throw new NotFoundError('Customer account');
    }
    if (input.customerId) {
      await CustomerService.assertCustomerInOrg(organizationId, input.customerId);
    }
    if (input.packageId) {
      await this.getPackage(organizationId, branchId, input.packageId);
    }
    const eventDate = new Date(input.eventDate);
    if (Number.isNaN(eventDate.getTime())) {
      throw new ConflictError('eventDate is not a valid date/time.');
    }

    return prisma.$transaction(async (tx) => {
      const inquiry = await tx.cateringInquiry.create({
        data: {
          organizationId,
          branchId,
          customerUserId: input.customerUserId,
          customerId: input.customerId,
          guestName: input.guestName,
          guestEmail: input.guestEmail,
          guestPhone: input.guestPhone,
          eventType: input.eventType,
          eventDate,
          location: input.location,
          guestCount: input.guestCount,
          packageId: input.packageId,
          menuRequirements: input.menuRequirements,
          equipmentRequests: input.equipmentRequests,
          staffRequests: input.staffRequests,
          setupRequests: input.setupRequests,
          deliveryRequested: input.deliveryRequested,
          deliveryAddress: input.deliveryAddress,
          specialRequests: input.specialRequests,
        },
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'catering_inquiry.create', entityType: 'CateringInquiry', entityId: inquiry.id, newValue: inquiry,
      });
      return inquiry;
    });
  }

  /** Edits inquiry details. Blocked once a quote exists (QUOTED/CONVERTED) — amend the quote instead. */
  static async updateInquiry(
    organizationId: string,
    branchId: string,
    inquiryId: string,
    input: UpdateCateringInquiryInput,
    actorUserId: string,
  ) {
    const existing = await this.getInquiry(organizationId, branchId, inquiryId);
    if (existing.status !== 'NEW' && input.status === undefined) {
      throw new ConflictError(`Cannot edit inquiry details once it is ${existing.status} — amend the quote instead.`);
    }
    let eventDate: Date | undefined;
    if (input.eventDate) {
      eventDate = new Date(input.eventDate);
      if (Number.isNaN(eventDate.getTime())) throw new ConflictError('eventDate is not a valid date/time.');
    }

    return prisma.$transaction(async (tx) => {
      const inquiry = await tx.cateringInquiry.update({
        where: { id: inquiryId },
        data: { ...input, eventDate },
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'catering_inquiry.update', entityType: 'CateringInquiry', entityId: inquiry.id,
        previousValue: existing, newValue: inquiry,
      });
      return inquiry;
    });
  }

  /** Marks an inquiry CANCELLED (customer backed out before any quote was accepted). */
  static async cancelInquiry(organizationId: string, branchId: string, inquiryId: string, actorUserId: string) {
    const existing = await this.getInquiry(organizationId, branchId, inquiryId);
    if (existing.status === 'CONVERTED') {
      throw new ConflictError('Cannot cancel an inquiry that already converted to a catering event.');
    }
    return this.updateInquiry(organizationId, branchId, inquiryId, { status: 'CANCELLED' }, actorUserId);
  }

  // --- quotes --------------------------------------------------------------------

  static async listQuotes(organizationId: string, branchId: string, query: ListCateringQuotesQueryInput) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.cateringQuote.findMany({
      where: { organizationId, branchId, status: query.status, inquiryId: query.inquiryId },
      include: QUOTE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getQuote(organizationId: string, branchId: string, quoteId: string) {
    const quote = await prisma.cateringQuote.findFirst({
      where: { id: quoteId, branchId, organizationId },
      include: QUOTE_INCLUDE,
    });
    if (!quote) throw new NotFoundError('Catering quote');
    return quote;
  }

  /**
   * Creates a DRAFT quote for an inquiry, server-computing food/tax/total
   * from the submitted items and flat fee amounts — the master spec's
   * quotation formula (Food + Staffing + Equipment + Transportation +
   * Setup + Service Fees - Discounts + Taxes = TOTAL), never trusting a
   * client-submitted total, same rule Phase 4 established for `Order`.
   * Bumps the parent inquiry to QUOTED if it is still NEW.
   */
  static async createQuote(
    organizationId: string,
    branchId: string,
    input: CreateCateringQuoteInput,
    actorUserId: string,
  ) {
    const inquiry = await this.getInquiry(organizationId, branchId, input.inquiryId);
    if (inquiry.status === 'CONVERTED' || inquiry.status === 'CANCELLED') {
      throw new ConflictError(`Cannot quote an inquiry that is already ${inquiry.status}.`);
    }
    if (input.packageId) {
      await this.getPackage(organizationId, branchId, input.packageId);
    }

    const totals = this.computeQuoteTotals(input);

    return prisma.$transaction(async (tx) => {
      const quote = await tx.cateringQuote.create({
        data: {
          organizationId,
          branchId,
          inquiryId: input.inquiryId,
          packageId: input.packageId,
          guestCount: input.guestCount,
          foodTotal: totals.foodTotal.toFixed(2),
          staffingTotal: totals.staffingTotal.toFixed(2),
          equipmentTotal: totals.equipmentTotal.toFixed(2),
          transportationTotal: totals.transportationTotal.toFixed(2),
          setupTotal: totals.setupTotal.toFixed(2),
          serviceFeeTotal: totals.serviceFeeTotal.toFixed(2),
          discountTotal: totals.discountTotal.toFixed(2),
          taxTotal: totals.taxTotal.toFixed(2),
          total: totals.total.toFixed(2),
          items: {
            create: input.items.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: new Prisma.Decimal(item.unitPrice).times(item.quantity).toFixed(2),
            })),
          },
        },
        include: QUOTE_INCLUDE,
      });

      if (inquiry.status === 'NEW') {
        await tx.cateringInquiry.update({ where: { id: inquiry.id }, data: { status: 'QUOTED' } });
      }

      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'catering_quote.create', entityType: 'CateringQuote', entityId: quote.id, newValue: quote,
      });
      return quote;
    });
  }

  /** Replaces a DRAFT quote's items/fees and recomputes totals. Blocked once sent. */
  static async updateQuote(
    organizationId: string,
    branchId: string,
    quoteId: string,
    input: UpdateCateringQuoteInput,
    actorUserId: string,
  ) {
    const existing = await this.getQuote(organizationId, branchId, quoteId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictError(`Cannot edit a quote once it is ${existing.status} — only DRAFT quotes may be amended.`);
    }
    if (input.packageId) {
      await this.getPackage(organizationId, branchId, input.packageId);
    }

    const merged: CreateCateringQuoteInput = {
      inquiryId: existing.inquiryId,
      packageId: input.packageId ?? existing.packageId ?? undefined,
      guestCount: input.guestCount ?? existing.guestCount,
      items: input.items ?? existing.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice.toString() })),
      staffingTotal: input.staffingTotal ?? existing.staffingTotal.toString(),
      equipmentTotal: input.equipmentTotal ?? existing.equipmentTotal.toString(),
      transportationTotal: input.transportationTotal ?? existing.transportationTotal.toString(),
      setupTotal: input.setupTotal ?? existing.setupTotal.toString(),
      serviceFeeTotal: input.serviceFeeTotal ?? existing.serviceFeeTotal.toString(),
      discountTotal: input.discountTotal ?? existing.discountTotal.toString(),
    };
    const totals = this.computeQuoteTotals(merged);

    return prisma.$transaction(async (tx) => {
      await tx.cateringQuoteItem.deleteMany({ where: { quoteId } });
      const quote = await tx.cateringQuote.update({
        where: { id: quoteId },
        data: {
          packageId: merged.packageId,
          guestCount: merged.guestCount,
          foodTotal: totals.foodTotal.toFixed(2),
          staffingTotal: totals.staffingTotal.toFixed(2),
          equipmentTotal: totals.equipmentTotal.toFixed(2),
          transportationTotal: totals.transportationTotal.toFixed(2),
          setupTotal: totals.setupTotal.toFixed(2),
          serviceFeeTotal: totals.serviceFeeTotal.toFixed(2),
          discountTotal: totals.discountTotal.toFixed(2),
          taxTotal: totals.taxTotal.toFixed(2),
          total: totals.total.toFixed(2),
          items: {
            create: merged.items.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: new Prisma.Decimal(item.unitPrice).times(item.quantity).toFixed(2),
            })),
          },
        },
        include: QUOTE_INCLUDE,
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'catering_quote.update', entityType: 'CateringQuote', entityId: quote.id,
        previousValue: existing, newValue: quote,
      });
      return quote;
    });
  }

  /**
   * Whitelisted status transitions. ACCEPTED is special-cased: in the same
   * transaction it creates the 1:1 CateringEvent (master spec §22 — "When
   * accepted, create the appropriate catering event"), snapshots the
   * quote's items as CateringEventItems, and bumps the parent inquiry to
   * CONVERTED — mirroring how Phase 6's DeliveryOrder is created inside
   * OrderService.createOrder's own transaction rather than a separate step.
   */
  static async updateQuoteStatus(
    organizationId: string,
    branchId: string,
    quoteId: string,
    input: UpdateCateringQuoteStatusInput,
    actorUserId: string,
  ) {
    const quote = await this.getQuote(organizationId, branchId, quoteId);
    if (quote.status === input.status) return quote;

    const allowed = QUOTE_ALLOWED_TRANSITIONS[quote.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Cannot move quote from ${quote.status} to ${input.status}. Allowed next states: ${allowed.join(', ') || 'none'}.`,
      );
    }
    if (input.status === 'REJECTED' && !input.rejectionReason) {
      throw new ConflictError('rejectionReason is required when rejecting a quote.');
    }
    if (input.status === 'CANCELLED' && !input.cancellationReason) {
      throw new ConflictError('cancellationReason is required when cancelling a quote.');
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.cateringQuote.update({
        where: { id: quoteId },
        data: {
          status: input.status,
          sentAt: input.status === 'SENT' ? new Date() : quote.sentAt,
          viewedAt: input.status === 'VIEWED' ? new Date() : quote.viewedAt,
          respondedAt: ['ACCEPTED', 'REJECTED'].includes(input.status) ? new Date() : quote.respondedAt,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : quote.expiresAt,
          rejectionReason: input.status === 'REJECTED' ? input.rejectionReason : quote.rejectionReason,
          cancellationReason: input.status === 'CANCELLED' ? input.cancellationReason : quote.cancellationReason,
        },
      });

      if (input.status === 'ACCEPTED') {
        const event = await tx.cateringEvent.create({
          data: {
            organizationId,
            branchId,
            quoteId: quote.id,
            customerUserId: quote.inquiry.customerUserId,
            // Phase 8 — CRM. Copied from the inquiry, not client-settable —
            // see the "Phase 8 — CRM" comment block in schema.prisma (#2).
            customerId: quote.inquiry.customerId,
            guestName: quote.inquiry.guestName,
            guestEmail: quote.inquiry.guestEmail,
            guestPhone: quote.inquiry.guestPhone,
            eventType: quote.inquiry.eventType,
            eventDate: quote.inquiry.eventDate,
            location: quote.inquiry.location,
            guestCount: quote.guestCount,
            total: quote.total,
          },
        });
        if (quote.items.length > 0) {
          await tx.cateringEventItem.createMany({
            data: quote.items.map((item) => ({
              eventId: event.id,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
            })),
          });
        }
        await tx.cateringInquiry.update({ where: { id: quote.inquiryId }, data: { status: 'CONVERTED' } });
      }

      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'catering_quote.status_change', entityType: 'CateringQuote', entityId: quoteId,
        previousValue: { status: quote.status }, newValue: { status: input.status, note: input.note },
      });

      return tx.cateringQuote.findUniqueOrThrow({ where: { id: updated.id }, include: QUOTE_INCLUDE });
    });
  }

  // --- events --------------------------------------------------------------------

  static async listEvents(organizationId: string, branchId: string, query: ListCateringEventsQueryInput) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.cateringEvent.findMany({
      where: { organizationId, branchId, status: query.status },
      include: EVENT_INCLUDE,
      orderBy: { eventDate: 'asc' },
    });
  }

  static async getEvent(organizationId: string, branchId: string, eventId: string) {
    const event = await prisma.cateringEvent.findFirst({
      where: { id: eventId, branchId, organizationId },
      include: EVENT_INCLUDE,
    });
    if (!event) throw new NotFoundError('Catering event');
    return event;
  }

  /** Sum of COMPLETED payments minus REFUNDED, and whether that covers the event total — same shape as OrderService.paymentSummary. */
  static paymentSummary(event: { total: Prisma.Decimal | string; payments: Array<{ amount: Prisma.Decimal | string; status: string }> }) {
    let paid = new Prisma.Decimal(0);
    for (const p of event.payments) {
      const amount = new Prisma.Decimal(p.amount as never);
      if (p.status === 'COMPLETED') paid = paid.plus(amount);
      else if (p.status === 'REFUNDED') paid = paid.minus(amount);
    }
    const total = new Prisma.Decimal(event.total as never);
    const balanceDue = total.minus(paid);
    return { paidAmount: paid.toFixed(2), balanceDue: balanceDue.toFixed(2), isFullyPaid: balanceDue.lte(0) };
  }

  static async updateEventStatus(
    organizationId: string,
    branchId: string,
    eventId: string,
    input: UpdateCateringEventStatusInput,
    actorUserId: string,
  ) {
    const event = await this.getEvent(organizationId, branchId, eventId);
    if (event.status === input.status) return event;

    const allowed = EVENT_ALLOWED_TRANSITIONS[event.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Cannot move event from ${event.status} to ${input.status}. Allowed next states: ${allowed.join(', ') || 'none'}.`,
      );
    }
    if (input.status === 'CANCELLED' && !input.cancellationReason) {
      throw new ConflictError('cancellationReason is required when cancelling a catering event.');
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.cateringEvent.update({
        where: { id: eventId },
        data: {
          status: input.status,
          cancellationReason: input.status === 'CANCELLED' ? input.cancellationReason : event.cancellationReason,
        },
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'catering_event.status_change', entityType: 'CateringEvent', entityId: eventId,
        previousValue: { status: event.status }, newValue: { status: input.status, note: input.note },
      });
      return tx.cateringEvent.findUniqueOrThrow({ where: { id: updated.id }, include: EVENT_INCLUDE });
    });
  }

  /**
   * Manually records a deposit or balance payment against an event. No
   * payment gateway exists yet — staff attesting money changed hands, same
   * pattern as OrderService.recordPayment/ReservationService.recordDeposit.
   */
  static async recordPayment(
    organizationId: string,
    branchId: string,
    eventId: string,
    input: RecordCateringPaymentInput,
    actorUserId: string,
  ) {
    const event = await this.getEvent(organizationId, branchId, eventId);

    return prisma.$transaction(async (tx) => {
      const payment = await tx.cateringPayment.create({
        data: {
          organizationId,
          branchId,
          eventId,
          type: input.type,
          method: input.method,
          amount: input.amount,
          status: input.status,
          note: input.note,
          recordedByUserId: actorUserId,
        },
      });

      // Phase 10 — Accounting. §23: deposits are a liability, never
      // automatic revenue. A DEPOSIT payment posts Debit Cash / Credit
      // Customer Deposits (or the reverse if recorded as a refund); a
      // BALANCE payment is this build's revenue-recognition trigger for
      // catering, recognizing the sum of actual payments received to date
      // (this payment plus every prior COMPLETED deposit) rather than the
      // quoted total — see schema.prisma's Phase 10 decision #4. A BALANCE
      // payment recorded as REFUNDED is deliberately left unwired (see
      // AccountingService.recordCateringDepositRefunded's doc comment).
      if (input.type === 'DEPOSIT' && input.status === 'COMPLETED') {
        await AccountingService.recordCateringDepositReceived(
          tx, organizationId, branchId, { id: payment.id, amount: payment.amount }, actorUserId,
        );
      } else if (input.type === 'DEPOSIT' && input.status === 'REFUNDED') {
        await AccountingService.recordCateringDepositRefunded(
          tx, organizationId, branchId, { id: payment.id, amount: payment.amount }, actorUserId,
        );
      } else if (input.type === 'BALANCE' && input.status === 'COMPLETED') {
        const depositAgg = await tx.cateringPayment.aggregate({
          where: { eventId, type: 'DEPOSIT', status: 'COMPLETED' },
          _sum: { amount: true },
        });
        await AccountingService.recordCateringBalanceSettled(
          tx, organizationId, branchId,
          {
            eventId,
            balancePaymentId: payment.id,
            balanceAmount: payment.amount,
            depositPaidToDate: depositAgg._sum.amount ?? new Prisma.Decimal(0),
          },
          actorUserId,
        );
      }

      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'catering_event.payment_recorded', entityType: 'CateringEvent', entityId: eventId, newValue: payment,
      });
      return tx.cateringEvent.findUniqueOrThrow({ where: { id: event.id }, include: EVENT_INCLUDE });
    });
  }

  // --- pricing --------------------------------------------------------------

  private static computeQuoteTotals(input: CreateCateringQuoteInput) {
    const foodTotal = input.items.reduce(
      (sum, item) => sum.plus(new Prisma.Decimal(item.unitPrice).times(item.quantity)),
      new Prisma.Decimal(0),
    );
    const staffingTotal = new Prisma.Decimal(input.staffingTotal);
    const equipmentTotal = new Prisma.Decimal(input.equipmentTotal);
    const transportationTotal = new Prisma.Decimal(input.transportationTotal);
    const setupTotal = new Prisma.Decimal(input.setupTotal);
    const serviceFeeTotal = new Prisma.Decimal(input.serviceFeeTotal);
    const discountTotal = new Prisma.Decimal(input.discountTotal);

    // Master spec §22 formula: Food + Staffing + Equipment + Transportation
    // + Setup + Service Fees - Discounts + Taxes = TOTAL.
    const preTaxSubtotal = foodTotal
      .plus(staffingTotal)
      .plus(equipmentTotal)
      .plus(transportationTotal)
      .plus(setupTotal)
      .plus(serviceFeeTotal)
      .minus(discountTotal);
    const taxTotal = preTaxSubtotal.times(PROVISIONAL_VAT_RATE);
    const total = preTaxSubtotal.plus(taxTotal);

    return { foodTotal, staffingTotal, equipmentTotal, transportationTotal, setupTotal, serviceFeeTotal, discountTotal, taxTotal, total };
  }

  private static async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }
}
