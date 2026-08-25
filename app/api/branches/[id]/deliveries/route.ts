import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { listDeliveriesQuerySchema } from '@/lib/validation/delivery';
import { DeliveryService } from '@/services/delivery/DeliveryService';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.DELIVERY_MANAGE);
    const { searchParams } = new URL(request.url);
    const query = listDeliveriesQuerySchema.parse({
      status: searchParams.get('status') ?? undefined,
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const deliveries = await DeliveryService.list(session.organizationId, params.id, query);
    return NextResponse.json({ deliveries });
  } catch (error) {
    return toErrorResponse(error);
  }
}
