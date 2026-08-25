import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createPromotionSchema, listPromotionsQuerySchema } from '@/lib/validation/promotion';
import { PromotionService } from '@/services/promotions/PromotionService';

// Org-scoped, no [id] path segment — same "my own organization's settings"
// shape as app/api/branding/route.ts. A promotion is restaurant-wide, not
// branch-specific (see schema.prisma's Promotion comment).
export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const { searchParams } = new URL(request.url);
    const query = listPromotionsQuerySchema.parse({
      status: searchParams.get('status') ?? undefined,
      take: searchParams.get('take') ?? undefined,
      skip: searchParams.get('skip') ?? undefined,
    });
    const promotions = await PromotionService.list(session.organizationId, query);
    return NextResponse.json({ promotions });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const body = await request.json();
    const input = createPromotionSchema.parse(body);
    const promotion = await PromotionService.create(session.organizationId, input, session.userId);
    return NextResponse.json({ promotion }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
