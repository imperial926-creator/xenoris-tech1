import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { PlatformAdminManagementService } from '@/services/platform-analytics/PlatformAdminManagementService';

const bodySchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'SALES_ADMIN', 'ANALYTICS_ADMIN', 'DEVELOPER', 'AUDITOR']),
});

export async function PUT(request: NextRequest, { params }: { params: { adminId: string } }) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'admin_management', { requireWrite: true });
    const body = bodySchema.parse(await request.json());
    const admin = await PlatformAdminManagementService.updateRole(params.adminId, body.role, session.platformAdminId);
    return NextResponse.json({ admin: { id: admin.id, role: admin.role } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
