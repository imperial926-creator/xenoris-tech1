import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { listCateringEventsQuerySchema } from '@/lib/validation/catering';
import { CateringService } from '@/services/catering/CateringService';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.CATERING_MANAGE);
    const { searchParams } = new URL(request.url);
    const query = listCateringEventsQuerySchema.parse({ status: searchParams.get('status') ?? undefined });
    const events = await CateringService.listEvents(session.organizationId, params.id, query);
    return NextResponse.json({ events });
  } catch (error) {
    return toErrorResponse(error);
  }
}
