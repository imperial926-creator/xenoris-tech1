import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { verifyPassword } from '@/lib/auth/password';
import { createPlatformAdminSessionToken } from '@/lib/platform-admin/session';
import { writePlatformAuditLog } from '@/lib/platform-admin/audit';
import type { PlatformAdminLoginInput } from '@/lib/validation/platform-billing';
import { PlatformHealthService } from '@/services/platform-analytics/PlatformHealthService';
import { PlatformEventTrackingService, EVENT_TYPES } from '@/services/platform-analytics/PlatformEventTrackingService';

export class InvalidPlatformAdminCredentialsError extends Error {
  constructor() {
    super('Invalid email or password.');
    this.name = 'InvalidPlatformAdminCredentialsError';
  }
}

/**
 * Master spec §3: "The Initial Payment Setup Wizard is ONLY available to
 * the authorized SaaS Owner / Platform Administrator ... Restaurant owners
 * must NEVER see this setup wizard." There is deliberately no public
 * `register` here — PlatformAdmin accounts are created only via
 * `prisma/seed.ts` (dev) or a one-time bootstrap script reading
 * `PLATFORM_ADMIN_BOOTSTRAP_EMAIL`/`PLATFORM_ADMIN_BOOTSTRAP_PASSWORD`
 * (production — see docs/deployment/production-checklist.md).
 */
export class PlatformAdminAuthService {
  static async login(input: PlatformAdminLoginInput): Promise<{ token: string }> {
    const admin = await prisma.platformAdmin.findUnique({ where: { email: input.email } });
    // Same "compare against a dummy hash even when the account doesn't
    // exist" timing-attack mitigation as AuthService.login would use —
    // bcrypt.compare against a fixed hash keeps the response time
    // consistent for a nonexistent email vs. a wrong password.
    const passwordHash = admin?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const valid = await verifyPassword(input.password, passwordHash);

    if (!admin || !valid || admin.status !== 'ACTIVE') {
      await PlatformHealthService.record({
        type: 'LOGIN_FAILURE',
        severity: 'LOW',
        message: 'Platform admin login failed',
        metadata: { email: input.email },
      });
      throw new InvalidPlatformAdminCredentialsError();
    }

    const token = await createPlatformAdminSessionToken({ platformAdminId: admin.id, email: admin.email });

    await writePlatformAuditLog(prisma, {
      platformAdminId: admin.id,
      action: 'platform_admin.login',
      entityType: 'PlatformAdmin',
      entityId: admin.id,
    });
    await PlatformEventTrackingService.track({
      eventType: EVENT_TYPES.PLATFORM_ADMIN_LOGIN,
      userId: admin.id,
    });

    return { token };
  }
}
