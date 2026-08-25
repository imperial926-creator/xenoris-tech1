import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { addActionCenterNoteSchema } from '@/lib/validation/platform-analytics';
import { ActionCenterService } from '@/services/platform-billing/ActionCenterService';

// Master spec §35's timestamped, attributed Action notes.
export async function POST(request: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'action_center', { requireWrite: true });
    const body = addActionCenterNoteSchema.parse(await request.json());
    const note = await ActionCenterService.addNote(params.taskId, session.platformAdminId, body.note);
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
