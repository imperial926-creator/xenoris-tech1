import 'server-only';
// Reuses the SAME `ForbiddenError` class the staff/owner RBAC module
// throws (`lib/auth/rbac.ts`) — `toErrorResponse` already maps it to HTTP
// 403, so platform-admin authorization failures get identical handling
// without adding a second near-duplicate error class.
import { ForbiddenError } from '@/lib/auth/rbac';

/**
 * Phase 18's admin RBAC matrix — master Data Analytics spec's role list
 * (§ dashboards, Action Center §65 "ACTION CENTER SECURITY"): SUPER_ADMIN
 * has everything, every other role is scoped to one business function, and
 * AUDITOR is read-only across all of them. This is deliberately a small,
 * fixed set of coarse-grained "resource" strings rather than the
 * fine-grained `PERMISSIONS` catalog `lib/auth/constants.ts` uses for
 * staff/owner accounts — platform admin accounts are provisioned by other
 * platform admins (no self-service registration, see
 * `PlatformAdminAuthService`'s header), so a small number of roles that
 * map obviously onto a real job title is more appropriate than a granular
 * permission-per-checkbox system nobody but the SUPER_ADMIN will ever
 * configure.
 */
export type PlatformAdminRole =
  | 'SUPER_ADMIN'
  | 'FINANCE_ADMIN'
  | 'SUPPORT_ADMIN'
  | 'SALES_ADMIN'
  | 'ANALYTICS_ADMIN'
  | 'DEVELOPER'
  | 'AUDITOR';

export const PLATFORM_ADMIN_RESOURCES = [
  'billing',
  'analytics',
  'complaints',
  'sales',
  'technical',
  'audit',
  'action_center',
  'admin_management',
] as const;
export type PlatformAdminResource = (typeof PLATFORM_ADMIN_RESOURCES)[number];

const ALL_RESOURCES = new Set<PlatformAdminResource>(PLATFORM_ADMIN_RESOURCES);

// Master spec Action Center §65's exact grouping, extended to the wider
// resource set this phase introduces (analytics, audit, admin_management).
const ROLE_RESOURCES: Record<PlatformAdminRole, Set<PlatformAdminResource>> = {
  SUPER_ADMIN: ALL_RESOURCES,
  FINANCE_ADMIN: new Set(['billing', 'action_center']),
  SUPPORT_ADMIN: new Set(['complaints', 'action_center']),
  SALES_ADMIN: new Set(['sales', 'action_center']),
  ANALYTICS_ADMIN: new Set(['analytics', 'action_center']),
  DEVELOPER: new Set(['technical', 'action_center']),
  AUDITOR: ALL_RESOURCES, // read-only — enforced by callers using `requireReadOnly` below, not by resource scope
};

const WRITE_ROLES: ReadonlySet<PlatformAdminRole> = new Set([
  'SUPER_ADMIN',
  'FINANCE_ADMIN',
  'SUPPORT_ADMIN',
  'SALES_ADMIN',
  'ANALYTICS_ADMIN',
  'DEVELOPER',
]);

export function canAccessResource(role: PlatformAdminRole, resource: PlatformAdminResource): boolean {
  return ROLE_RESOURCES[role]?.has(resource) ?? false;
}

export function canWrite(role: PlatformAdminRole): boolean {
  return WRITE_ROLES.has(role);
}

/**
 * Throws `ForbiddenError` (mapped to HTTP 403 by `toErrorResponse`) unless
 * `role` may access `resource`. `requireWrite: true` additionally rejects
 * AUDITOR, whose role grants read access to every resource but no mutation
 * rights anywhere — see master spec Action Center §65's "Super Admin: All
 * actions" vs. every other role being read/write-scoped to its own area,
 * plus the spec's general "AUDITOR" convention of read-only platform access.
 */
export function requirePlatformAdminAccess(
  role: PlatformAdminRole,
  resource: PlatformAdminResource,
  options: { requireWrite?: boolean } = {},
): void {
  if (!canAccessResource(role, resource)) {
    throw new ForbiddenError(`Role ${role} does not have access to ${resource}`);
  }
  if (options.requireWrite && !canWrite(role)) {
    throw new ForbiddenError(`Role ${role} is read-only`);
  }
}
