import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createCateringInquirySchema, listCateringInquiriesQuerySchema } from '@/lib/validation/catering';
import { CateringService } from '@/services/catering/CateringService';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const { searchParams } = new URL(request.url);
    const query = listCateringInquiriesQuerySchema.parse({
      status: searchParams.get('status') ?? undefined,
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const inquiries = await CateringService.listInquiries(session.organizationId, params.id, query);
    return NextResponse.json({ inquiries });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const body = await request.json();
    const input = createCateringInquirySchema.parse(body);
    const inquiry = await CateringService.createInquiry(session.organizationId, params.id, input, session.userId);
    return NextResponse.json({ inquiry }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
