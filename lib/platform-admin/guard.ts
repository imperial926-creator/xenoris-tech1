import 'server-only';
import { prisma } from '@/lib/db/prisma';
import type { PlatformAdminSessionPayload } from './session';
import type { PlatformAdminRole } from './rbac';

export class PlatformAdminUnauthenticatedError extends Error {
  constructor() {
    super('Platform administrator authentication required.');
    this.name = 'PlatformAdminUnauthenticatedError';
  }
}

export class PlatformAdminDisabledError extends Error {
  constructor() {
    super('This platform administrator account has been disabled.');
    this.name = 'PlatformAdminDisabledError';
  }
}

/**
 * Master spec §51: "only authorized SaaS administrators may ... All
 * administrative actions must be recorded in an audit log." Every
 * `/api/v1/platform/admin/**` route handler calls this first — it re-checks
 * the account's status against the database rather than trusting the JWT's
 * mere presence, so disabling a compromised platform-admin account takes
 * effect immediately instead of waiting out an 8-hour session TTL.
 *
 * Phase 18: also returns the account's CURRENT `role`, read fresh from the
 * database on every call (not carried in the JWT) — the same reasoning as
 * re-checking `status`: revoking/downgrading a compromised or
 * role-changed admin's access must take effect immediately, not after an
 * 8-hour session TTL. Callers that need role-gated access (most of
 * `/api/platform-admin/**`) pass `result.role` to
 * `requirePlatformAdminAccess` from `./rbac`.
 */
export async function requirePlatformAdmin(
  session: PlatformAdminSessionPayload | null,
): Promise<PlatformAdminSessionPayload & { role: PlatformAdminRole }> {
  if (!session) throw new PlatformAdminUnauthenticatedError();
  const admin = await prisma.platformAdmin.findUnique({ where: { id: session.platformAdminId } });
  if (!admin || admin.status !== 'ACTIVE') throw new PlatformAdminDisabledError();
  return { ...session, role: admin.role as PlatformAdminRole };
}
