import 'server-only';
import { prisma } from '@/lib/db/prisma';

/** Master spec §49: admin search across payments by restaurant/invoice/transaction/date/amount/plan/status. */
export class PaymentSearchService {
  static async search(params: {
    organizationId?: string;
    invoiceNumber?: string;
    paymentId?: string;
    transactionId?: string;
    status?: 'INITIATED' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
  }) {
    let invoiceOrgFilter: string[] | undefined;
    if (params.invoiceNumber) {
      const invoices = await prisma.platformInvoice.findMany({
        where: { invoiceNumber: { contains: params.invoiceNumber, mode: 'insensitive' } },
        select: { id: true },
      });
      invoiceOrgFilter = invoices.map((i) => i.id);
    }

    return prisma.subscriptionPayment.findMany({
      where: {
        id: params.paymentId || undefined,
        organizationId: params.organizationId || undefined,
        providerTransactionId: params.transactionId
          ? { contains: params.transactionId, mode: 'insensitive' }
          : undefined,
        status: params.status,
        createdAt:
          params.dateFrom || params.dateTo
            ? { gte: params.dateFrom, lte: params.dateTo }
            : undefined,
        invoice: invoiceOrgFilter ? { id: { in: invoiceOrgFilter } } : undefined,
      },
      include: {
        organization: { select: { id: true, name: true } },
        subscription: { include: { plan: { select: { id: true, name: true } } } },
        invoice: { select: { id: true, invoiceNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
    });
  }
}
