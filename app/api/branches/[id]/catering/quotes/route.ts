import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createCateringQuoteSchema, listCateringQuotesQuerySchema } from '@/lib/validation/catering';
import { CateringService } from '@/services/catering/CateringService';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const { searchParams } = new URL(request.url);
    const query = listCateringQuotesQuerySchema.parse({
      status: searchParams.get('status') ?? undefined,
      inquiryId: searchParams.get('inquiryId') ?? undefined,
    });
    const quotes = await CateringService.listQuotes(session.organizationId, params.id, query);
    return NextResponse.json({ quotes });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const body = await request.json();
    const input = createCateringQuoteSchema.parse(body);
    const quote = await CateringService.createQuote(session.organizationId, params.id, input, session.userId);
    return NextResponse.json({ quote }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
