import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateCateringInquirySchema } from '@/lib/validation/catering';
import { CateringService } from '@/services/catering/CateringService';

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ id: string; inquiryId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const inquiry = await CateringService.getInquiry(session.organizationId, params.id, params.inquiryId);
    return NextResponse.json({ inquiry });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string; inquiryId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const body = await request.json();
    const input = updateCateringInquirySchema.parse(body);
    const inquiry = await CateringService.updateInquiry(session.organizationId, params.id, params.inquiryId, input, session.userId);
    return NextResponse.json({ inquiry });
  } catch (error) {
    return toErrorResponse(error);
  }
}
