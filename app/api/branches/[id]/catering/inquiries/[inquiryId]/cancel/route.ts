import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { CateringService } from '@/services/catering/CateringService';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string; inquiryId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const inquiry = await CateringService.cancelInquiry(session.organizationId, params.id, params.inquiryId, session.userId);
    return NextResponse.json({ inquiry });
  } catch (error) {
    return toErrorResponse(error);
  }
}
