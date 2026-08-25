import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { listNotificationsQuerySchema } from '@/lib/validation/notification';
import { NotificationService } from '@/services/notifications/NotificationService';

/**
 * Phase 14 — Notification delivery history. Read-only: notifications are
 * only ever created as a side effect of the services that trigger them
 * (see NotificationService's class header), never directly through this
 * route.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.NOTIFICATION_VIEW);
    const { searchParams } = new URL(request.url);
    const query = listNotificationsQuerySchema.parse({
      type: searchParams.get('type') ?? undefined,
      channel: searchParams.get('channel') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      relatedEntityType: searchParams.get('relatedEntityType') ?? undefined,
      relatedEntityId: searchParams.get('relatedEntityId') ?? undefined,
      take: searchParams.get('take') ?? undefined,
    });
    const notifications = await NotificationService.list(session.organizationId, params.id, query);
    return NextResponse.json({ notifications });
  } catch (error) {
    return toErrorResponse(error);
  }
}
