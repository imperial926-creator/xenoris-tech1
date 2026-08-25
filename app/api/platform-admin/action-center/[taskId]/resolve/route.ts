import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { resolveActionCenterTaskSchema } from '@/lib/validation/platform-billing';
import { ActionCenterService } from '@/services/platform-billing/ActionCenterService';

export async function POST(request: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    const body = resolveActionCenterTaskSchema.parse(await request.json().catch(() => ({})));
    const task = await ActionCenterService.resolve(params.taskId, session.platformAdminId, body.resolutionNote);
    return NextResponse.json({ task });
  } catch (error) {
    return toErrorResponse(error);
  }
}
