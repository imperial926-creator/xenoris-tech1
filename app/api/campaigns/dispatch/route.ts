import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { NotificationDispatchService } from '@/services/notifications/NotificationDispatchService';

/**
 * Spec § 33's "Push/email/SMS workers" box, exposed as a real, staff-
 * authenticated trigger this build's own scheduler can't run automatically
 * (see NotificationDispatchService's header for the full reasoning). Not a
 * per-campaign route — one call drains whatever is QUEUED for this
 * organization across every campaign, matching how a real worker would
 * process a shared queue rather than being scoped to one job's output.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.PROMOTION_MANAGE);
    const body = await request.json().catch(() => ({}));
    const limit = typeof body?.limit === 'number' ? body.limit : undefined;
    const result = await NotificationDispatchService.dispatchQueued(session.organizationId, limit);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
