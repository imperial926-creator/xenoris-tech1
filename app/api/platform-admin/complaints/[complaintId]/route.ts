import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateComplaintSchema } from '@/lib/validation/platform-analytics';
import { ComplaintService } from '@/services/platform-analytics/ComplaintService';

export async function GET(_request: NextRequest, { params }: { params: { complaintId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'complaints');
    const complaint = await ComplaintService.get(params.complaintId);
    return NextResponse.json({ complaint });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { complaintId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'complaints', { requireWrite: true });
    const body = updateComplaintSchema.parse(await request.json());
    const complaint = await ComplaintService.update(params.complaintId, session.platformAdminId, body);
    return NextResponse.json({ complaint });
  } catch (error) {
    return toErrorResponse(error);
  }
}
