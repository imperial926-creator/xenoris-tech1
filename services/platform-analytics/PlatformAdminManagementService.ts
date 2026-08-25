import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { hashPassword } from '@/lib/auth/password';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';
import { writePlatformAuditLog } from '@/lib/platform-admin/audit';
import type { PlatformAdminRole } from '@/lib/platform-admin/rbac';

/**
 * Master Data Analytics spec's admin-roles RBAC matrix (SUPER_ADMIN/
 * FINANCE_ADMIN/SUPPORT_ADMIN/SALES_ADMIN/ANALYTICS_ADMIN/DEVELOPER/
 * AUDITOR) requires a way for a SUPER_ADMIN to provision other platform
 * admin accounts with a specific role. This is distinct from — and does
 * NOT reopen — the "no public self-registration" rule Phase 17's
 * `PlatformAdminAuthService` documents: every method here is itself gated
 * behind `requirePlatformAdminAccess(role, 'admin_management')` at the
 * route layer (SUPER_ADMIN only), never reachable by an unauthenticated
 * caller.
 */
export class PlatformAdminManagementService {
  static async list() {
    return prisma.platformAdmin.findMany({
      select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  static async create(
    params: { email: string; password: string; firstName: string; lastName: string; role: PlatformAdminRole },
    actingAdminId: string,
  ) {
    const existing = await prisma.platformAdmin.findUnique({ where: { email: params.email } });
    if (existing) throw new ConflictError('A platform admin with that email already exists.');

    const passwordHash = await hashPassword(params.password);
    return prisma.$transaction(async (tx) => {
      const admin = await tx.platformAdmin.create({
        data: {
          email: params.email,
          passwordHash,
          firstName: params.firstName,
          lastName: params.lastName,
          role: params.role,
        },
      });
      await writePlatformAuditLog(tx, {
        platformAdminId: actingAdminId,
        action: 'platform_admin.create',
        entityType: 'PlatformAdmin',
        entityId: admin.id,
        newValue: { email: admin.email, role: admin.role },
      });
      return admin;
    });
  }

  static async updateRole(adminId: string, role: PlatformAdminRole, actingAdminId: string) {
    const admin = await prisma.platformAdmin.findUnique({ where: { id: adminId } });
    if (!admin) throw new NotFoundError('Platform admin');

    return prisma.$transaction(async (tx) => {
      const updated = await tx.platformAdmin.update({ where: { id: adminId }, data: { role } });
      await writePlatformAuditLog(tx, {
        platformAdminId: actingAdminId,
        action: 'platform_admin.role_change',
        entityType: 'PlatformAdmin',
        entityId: adminId,
        previousValue: { role: admin.role },
        newValue: { role },
      });
      return updated;
    });
  }

  static async updateStatus(adminId: string, status: 'ACTIVE' | 'DISABLED', actingAdminId: string) {
    const admin = await prisma.platformAdmin.findUnique({ where: { id: adminId } });
    if (!admin) throw new NotFoundError('Platform admin');

    return prisma.$transaction(async (tx) => {
      const updated = await tx.platformAdmin.update({ where: { id: adminId }, data: { status } });
      await writePlatformAuditLog(tx, {
        platformAdminId: actingAdminId,
        action: 'platform_admin.status_change',
        entityType: 'PlatformAdmin',
        entityId: adminId,
        previousValue: { status: admin.status },
        newValue: { status },
      });
      return updated;
    });
  }
}
