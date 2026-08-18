import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { OrderService } from '@/services/orders/OrderService';
import { NotificationService } from '@/services/notifications/NotificationService';
import type { VoidInvoiceInput } from '@/lib/validation/order';

const INVOICE_INCLUDE = { items: true } satisfies Prisma.InvoiceInclude;

export class InvoiceService {
  static async list(organizationId: string, branchId: string) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.invoice.findMany({
      where: { organizationId, branchId },
      include: INVOICE_INCLUDE,
      orderBy: { issuedAt: 'desc' },
    });
  }

  static async get(organizationId: string, branchId: string, invoiceId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, branchId, organizationId },
      include: INVOICE_INCLUDE,
    });
    if (!invoice) throw new NotFoundError('Invoice');
    return invoice;
  }

  /**
   * Issues an invoice from a fully-paid order — a receipt documents
   * payment, not fulfillment, so this is gated on the order's payment
   * total covering its total, not on order.status. Numbering is sequential
   * per branch (InvoiceSequence, incremented atomically in this same
   * transaction) and at most one ISSUED invoice may exist per order at a
   * time — enforced by a partial unique index with no Prisma DSL
   * representation (see schema.prisma's "Phase 4" comment block). This
   * method checks that rule in application code first for a clear error
   * message, then relies on the index as the real guarantee under a race.
   */
  static async issueInvoice(
    organizationId: string,
    branchId: string,
    orderId: string,
    actorUserId: string,
  ) {
    const order = await OrderService.get(organizationId, branchId, orderId);
    const summary = OrderService.paymentSummary(order);
    if (!summary.isFullyPaid) {
      throw new ConflictError(
        `Order is not fully paid (balance due ₱${summary.balanceDue}) — record payment before issuing an invoice.`,
      );
    }

    const existingActive = await prisma.invoice.findFirst({
      where: { orderId, status: 'ISSUED' },
    });
    if (existingActive) {
      throw new ConflictError(
        `An active invoice (${existingActive.invoiceNumber}) already exists for this order — void it first to reissue.`,
      );
    }

    let issuedInvoice;
    try {
      issuedInvoice = await prisma.$transaction(async (tx) => {
        // Atomic per-branch counter: upsert increments under the row lock
        // Postgres takes on the UPDATE path, so two concurrent issuances
        // for the same branch serialize here rather than racing to read
        // the same "next number" — verified with a concurrent test (see
        // tests/integration/invoicing/invoice-service.test.ts).
        const sequence = await tx.invoiceSequence.upsert({
          where: { branchId },
          create: { organizationId, branchId, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        const invoiceNumber = `INV-${String(sequence.lastNumber).padStart(6, '0')}`;

        const invoice = await tx.invoice.create({
          data: {
            organizationId,
            branchId,
            orderId,
            invoiceNumber,
            subtotal: order.subtotal,
            taxTotal: order.taxTotal,
            discountTotal: order.discountTotal,
            total: order.total,
          },
        });

        for (const item of order.items) {
          const modifiersSummary = item.modifiers.map((m) => m.nameSnapshot).join(', ') || null;
          await tx.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              nameSnapshot: item.nameSnapshot,
              unitPriceSnapshot: item.unitPriceSnapshot,
              quantity: item.quantity,
              lineTotal: item.lineTotal,
              modifiersSummary,
            },
          });
        }

        await writeAuditLog(tx, {
          organizationId,
          branchId,
          userId: actorUserId,
          action: 'invoice.issue',
          entityType: 'Invoice',
          entityId: invoice.id,
          newValue: { invoiceNumber, orderId, total: invoice.total },
        });

        return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: INVOICE_INCLUDE });
      });
    } catch (error) {
      throw this.translateDbError(error);
    }

    // Phase 14 — Notifications. Fired after the transaction above has
    // already committed — see NotificationService's class header point 1.
    // Recipient sourced from `order`, already fetched at the top of this
    // method (Order has guestName/guestEmail/guestPhone as plain scalar
    // columns regardless of include).
    await NotificationService.sendInvoice(organizationId, branchId, {
      invoiceId: issuedInvoice.id,
      invoiceNumber: issuedInvoice.invoiceNumber,
      total: issuedInvoice.total,
      order,
    });

    return issuedInvoice;
  }

  static async voidInvoice(
    organizationId: string,
    branchId: string,
    invoiceId: string,
    input: VoidInvoiceInput,
    actorUserId: string,
  ) {
    const invoice = await this.get(organizationId, branchId, invoiceId);
    if (invoice.status === 'VOID') {
      throw new ConflictError('Invoice is already void.');
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'VOID', voidedAt: new Date(), voidReason: input.reason },
      });

      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'invoice.void',
        entityType: 'Invoice',
        entityId: invoiceId,
        previousValue: { status: invoice.status },
        newValue: { status: 'VOID', reason: input.reason },
      });

      return tx.invoice.findUniqueOrThrow({ where: { id: updated.id }, include: INVOICE_INCLUDE });
    });
  }

  private static async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }

  /**
   * The `invoices_one_active_per_order` partial unique index (see
   * schema.prisma) has no Prisma DSL representation, so — unlike a normal
   * `@@unique` — a violation may surface as a generic
   * PrismaClientUnknownRequestError rather than a mapped P2002. Same
   * translation approach as ReservationService.translateDbError.
   */
  private static translateDbError(error: unknown): unknown {
    if (error instanceof NotFoundError || error instanceof ConflictError) return error;
    if (error instanceof Error && error.message.includes('invoices_one_active_per_order')) {
      return new ConflictError('An active invoice already exists for this order — void it first to reissue.');
    }
    if (error instanceof Error && error.message.includes('invoices_branchId_invoiceNumber_key')) {
      return new ConflictError('Invoice number collision — please retry.');
    }
    return error;
  }
}
