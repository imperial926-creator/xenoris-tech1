import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateCateringQuoteStatusSchema } from '@/lib/validation/catering';
import { CateringService } from '@/services/catering/CateringService';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string; quoteId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const body = await request.json();
    const input = updateCateringQuoteStatusSchema.parse(body);
    const quote = await CateringService.updateQuoteStatus(
      session.organizationId,
      params.id,
      params.quoteId,
      input,
      session.userId,
    );
    return NextResponse.json({ quote });
  } catch (error) {
    return toErrorResponse(error);
  }
}
