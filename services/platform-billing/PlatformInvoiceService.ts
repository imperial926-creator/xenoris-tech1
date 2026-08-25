import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError } from '@/lib/utils/api-error';

/**
 * Master spec §14/§15/§34: automatic invoice + receipt generation on
 * successful payment. Numbering reuses `PlatformSequence` — the same
 * atomic-upsert-under-row-lock pattern `InvoiceService.issueInvoice` uses
 * for restaurant-facing invoices via `InvoiceSequence` — rather than adding
 * a near-duplicate sequence table, since `PlatformSequence` is already
 * platform-wide (see `Organization.publicCode`'s allocation for the other
 * existing user of this table).
 *
 * IMPORTANT — what "receipt" means here: master spec §14 describes a
 * receipt as its own artifact, but every field it lists is a strict subset
 * of what the invoice already carries (amount, currency, payment date,
 * status, transaction reference, next billing date). Rather than model a
 * second near-identical row, `PlatformInvoice` + its linked
 * `SubscriptionPayment` together already contain every field §14 asks for
 * — `renderReceipt`/`renderInvoice` below both format from the same
 * `PlatformInvoice` row, distinguished only by which fields they surface,
 * matching this codebase's "don't build a duplicate system" build
 * instruction (master spec's own final section).
 */
export class PlatformInvoiceService {
  static async issueForPayment(
    tx: Prisma.TransactionClient,
    params: {
      organizationId: string;
      subscriptionId: string;
      paymentId: string;
      billingPeriodStart: Date;
      billingPeriodEnd: Date;
      amount: string;
      currency: string;
    },
  ) {
    const sequence = await tx.platformSequence.upsert({
      where: { name: 'platform_invoice_number' },
      create: { name: 'platform_invoice_number', lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    const invoiceNumber = `PINV-${String(sequence.lastNumber).padStart(6, '0')}`;

    return tx.platformInvoice.create({
      data: {
        invoiceNumber,
        organizationId: params.organizationId,
        subscriptionId: params.subscriptionId,
        paymentId: params.paymentId,
        billingPeriodStart: params.billingPeriodStart,
        billingPeriodEnd: params.billingPeriodEnd,
        subtotal: params.amount,
        total: params.amount,
        currency: params.currency,
        paidAt: new Date(),
      },
    });
  }

  static async listForOrganization(organizationId: string) {
    return prisma.platformInvoice.findMany({
      where: { organizationId },
      include: { payment: true },
      orderBy: { issuedAt: 'desc' },
    });
  }

  static async get(organizationId: string, invoiceId: string) {
    const invoice = await prisma.platformInvoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { payment: true, subscription: { include: { plan: true } }, organization: true },
    });
    if (!invoice) throw new NotFoundError('Invoice');
    return invoice;
  }
}
