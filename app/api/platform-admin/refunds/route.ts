import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { toErrorResponse } from '@/lib/utils/api-error';
import { issueRefundSchema } from '@/lib/validation/platform-billing';
import { PlatformRefundService } from '@/services/platform-billing/PlatformRefundService';

export async function POST(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    const body = issueRefundSchema.parse(await request.json());
    const refund = await PlatformRefundService.issue(body, session.platformAdminId);
    return NextResponse.json({ refund }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
