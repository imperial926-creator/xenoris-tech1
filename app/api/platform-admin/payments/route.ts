import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { PaymentSearchService } from '@/services/platform-billing/PaymentSearchService';

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(await getPlatformAdminSession());
    const q = request.nextUrl.searchParams;
    const payments = await PaymentSearchService.search({
      organizationId: q.get('organizationId') ?? undefined,
      invoiceNumber: q.get('invoiceNumber') ?? undefined,
      paymentId: q.get('paymentId') ?? undefined,
      transactionId: q.get('transactionId') ?? undefined,
      status: (q.get('status') as never) ?? undefined,
      dateFrom: q.get('dateFrom') ? new Date(q.get('dateFrom')!) : undefined,
      dateTo: q.get('dateTo') ? new Date(q.get('dateTo')!) : undefined,
    });
    return NextResponse.json({ payments });
  } catch (error) {
    return toErrorResponse(error);
  }
}
