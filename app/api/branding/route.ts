import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateBrandingSchema } from '@/lib/validation/branding';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';

// Staff-facing branding editor (CAPP Phase 2) — the customer app's public
// `GET /api/v1/restaurants/:restaurantId` reads whatever this writes (see
// RestaurantDirectoryService.getByPublicCode). No `[organizationId]` in the
// URL: like every other "my own organization's settings" route in this
// codebase, the session's own organizationId is the only one ever touched.
export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.BRANDING_MANAGE);
    const branding = await RestaurantDirectoryService.getBranding(session.organizationId);
    return NextResponse.json({ branding });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.BRANDING_MANAGE);
    const body = await request.json();
    const input = updateBrandingSchema.parse(body);
    const branding = await RestaurantDirectoryService.upsertBranding(
      session.organizationId,
      input,
      session.userId,
    );
    return NextResponse.json({ branding });
  } catch (error) {
    return toErrorResponse(error);
  }
}
