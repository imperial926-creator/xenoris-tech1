import 'server-only';
import { prisma } from '@/lib/db/prisma';
import type { PermissionKey } from './constants';
import type { SessionPayload } from './session';

export class UnauthenticatedError extends Error {
  constructor() {
    super('Authentication required.');
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends Error {
  constructor(permission?: string) {
    super(permission ? `Missing required permission: ${permission}` : 'Forbidden.');
    this.name = 'ForbiddenError';
  }
}

/**
 * Source of truth for "does this user have this permission" — always checks
 * the database (role -> role_permissions -> permission), scoped to the
 * user's organization. The JWT session's `roles` array is only ever used as
 * a fast, non-authoritative hint for UI rendering; every server-side
 * authorization decision goes through this function.
 */
export async function userHasPermission(
  userId: string,
  organizationId: string,
  permission: PermissionKey,
): Promise<boolean> {
  const count = await prisma.rolePermission.count({
    where: {
      permission: { key: permission },
      role: {
        organizationId,
        userRoles: { some: { userId } },
      },
    },
  });
  return count > 0;
}

/**
 * Throws UnauthenticatedError / ForbiddenError as appropriate. Route handlers
 * catch these and translate to 401 / 403 (see lib/utils/api-error.ts).
 */
export async function requirePermission(
  session: SessionPayload | null,
  permission: PermissionKey,
): Promise<SessionPayload> {
  if (!session) {
    throw new UnauthenticatedError();
  }
  const allowed = await userHasPermission(session.userId, session.organizationId, permission);
  if (!allowed) {
    throw new ForbiddenError(permission);
  }
  return session;
}

export function requireAuthenticated(session: SessionPayload | null): SessionPayload {
  if (!session) {
    throw new UnauthenticatedError();
  }
  return session;
}
