import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createComplaintSchema } from '@/lib/validation/platform-analytics';
import { ComplaintService } from '@/services/platform-analytics/ComplaintService';

// Master spec's Customer Support / Complaints module (ADMIN → CUSTOMER SUPPORT → COMPLAINTS).
export async function GET(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'complaints');
    const q = request.nextUrl.searchParams;
    type ComplaintStatusParam = 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'WAITING_FOR_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
    type ComplaintPriorityParam = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    const complaints = await ComplaintService.list({
      status: (q.get('status') as ComplaintStatusParam | null) ?? undefined,
      priority: (q.get('priority') as ComplaintPriorityParam | null) ?? undefined,
      organizationId: q.get('organizationId') ?? undefined,
    });
    return NextResponse.json({ complaints });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'complaints', { requireWrite: true });
    const body = createComplaintSchema.parse(await request.json());
    const complaint = await ComplaintService.create(body);
    return NextResponse.json({ complaint }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
