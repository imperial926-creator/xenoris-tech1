import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { requirePlatformAdminAccess } from '@/lib/platform-admin/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { PlatformAdminManagementService } from '@/services/platform-analytics/PlatformAdminManagementService';

const createAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(['SUPER_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'SALES_ADMIN', 'ANALYTICS_ADMIN', 'DEVELOPER', 'AUDITOR']),
});

// SUPER_ADMIN-only account provisioning — see PlatformAdminManagementService's header.
export async function GET() {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'admin_management');
    const admins = await PlatformAdminManagementService.list();
    return NextResponse.json({ admins });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePlatformAdmin(await getPlatformAdminSession());
    requirePlatformAdminAccess(session.role, 'admin_management', { requireWrite: true });
    const body = createAdminSchema.parse(await request.json());
    const admin = await PlatformAdminManagementService.create(body, session.platformAdminId);
    return NextResponse.json({ admin: { id: admin.id, email: admin.email, role: admin.role } }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
