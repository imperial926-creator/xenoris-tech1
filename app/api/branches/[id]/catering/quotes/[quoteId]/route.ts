import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateCateringQuoteSchema } from '@/lib/validation/catering';
import { CateringService } from '@/services/catering/CateringService';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; quoteId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const quote = await CateringService.getQuote(session.organizationId, params.id, params.quoteId);
    return NextResponse.json({ quote });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; quoteId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const body = await request.json();
    const input = updateCateringQuoteSchema.parse(body);
    const quote = await CateringService.updateQuote(session.organizationId, params.id, params.quoteId, input, session.userId);
    return NextResponse.json({ quote });
  } catch (error) {
    return toErrorResponse(error);
  }
}
