import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { FollowUpService } from '@/services/platform-analytics/FollowUpService';

const bodySchema = z.object({
  outcome: z.enum(['CONTACTED', 'WAITING_FOR_RESPONSE', 'FOLLOW_UP_REQUIRED', 'CONVERTED', 'RESOLVED', 'NOT_INTERESTED', 'NO_RESPONSE', 'CLOSED']),
  note: z.string().max(2000).optional(),
});

export async function POST(request: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'action_center', { requireWrite: true });
    const body = bodySchema.parse(await request.json());
    const task = await FollowUpService.recordOutcome(params.taskId, body.outcome, session.platformAdminId, body.note);
    return NextResponse.json({ task });
  } catch (error) {
    return toErrorResponse(error);
  }
}
