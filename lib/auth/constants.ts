/**
 * Central catalog of RBAC roles and permissions.
 *
 * Roles are the seven the master spec mandates. Permissions are grouped by
 * domain; only the ones relevant to Phase 1 (org/branch/user administration)
 * are wired to actual authorization checks today. The rest are declared here
 * so the permission catalog — and the seed script that grants them to roles —
 * doesn't need to be rewritten as later phases add their own checks.
 */

export const ROLE_NAMES = [
  'CUSTOMER',
  'STAFF',
  'MANAGER',
  'ACCOUNTANT',
  'DRIVER',
  'OWNER',
  'ADMINISTRATOR',
] as const;

export type RoleNameLiteral = (typeof ROLE_NAMES)[number];

export const PERMISSIONS = {
  ORG_MANAGE: 'org:manage',
  BRANCH_MANAGE: 'branch:manage',
  BRANCH_VIEW: 'branch:view',
  USER_MANAGE: 'user:manage',
  USER_VIEW: 'user:view',
  ROLE_MANAGE: 'role:manage',
  RESERVATION_MANAGE: 'reservation:manage',
  ORDER_MANAGE: 'order:manage',
  KITCHEN_VIEW: 'kitchen:view',
  DELIVERY_MANAGE: 'delivery:manage',
  CATERING_MANAGE: 'catering:manage',
  CUSTOMER_VIEW: 'customer:view',
  INVENTORY_MANAGE: 'inventory:manage',
  FINANCE_VIEW: 'finance:view',
  FINANCE_MANAGE: 'finance:manage',
  REPORTS_VIEW: 'reports:view',
  ANALYTICS_VIEW: 'analytics:view',
  AUDIT_VIEW: 'audit:view',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_CATALOG: Array<{ key: PermissionKey; description: string }> = [
  { key: PERMISSIONS.ORG_MANAGE, description: 'Create/update organization settings' },
  { key: PERMISSIONS.BRANCH_MANAGE, description: 'Create/update/deactivate branches' },
  { key: PERMISSIONS.BRANCH_VIEW, description: 'View branch details' },
  { key: PERMISSIONS.USER_MANAGE, description: 'Invite/manage staff users and role assignments' },
  { key: PERMISSIONS.USER_VIEW, description: 'View staff user list' },
  { key: PERMISSIONS.ROLE_MANAGE, description: 'Manage roles and permission grants' },
  { key: PERMISSIONS.RESERVATION_MANAGE, description: 'Manage reservations (Phase 3)' },
  { key: PERMISSIONS.ORDER_MANAGE, description: 'Manage orders (Phase 4)' },
  { key: PERMISSIONS.KITCHEN_VIEW, description: 'View kitchen display system (Phase 5)' },
  { key: PERMISSIONS.DELIVERY_MANAGE, description: 'Manage deliveries/drivers (Phase 6)' },
  { key: PERMISSIONS.CATERING_MANAGE, description: 'Manage catering inquiries/events (Phase 7)' },
  { key: PERMISSIONS.CUSTOMER_VIEW, description: 'View customer CRM records (Phase 8)' },
  { key: PERMISSIONS.INVENTORY_MANAGE, description: 'Manage inventory/purchasing (Phase 9)' },
  { key: PERMISSIONS.FINANCE_VIEW, description: 'View financial reports (Phase 10/11)' },
  { key: PERMISSIONS.FINANCE_MANAGE, description: 'Post/reverse journal entries (Phase 10)' },
  { key: PERMISSIONS.REPORTS_VIEW, description: 'Export reports (Phase 11+)' },
  { key: PERMISSIONS.ANALYTICS_VIEW, description: 'View owner analytics dashboards (Phase 12)' },
  { key: PERMISSIONS.AUDIT_VIEW, description: 'View audit logs' },
];

/**
 * Default permission grants per role, seeded for every new organization.
 * Deliberately conservative: CUSTOMER gets nothing administrative, STAFF gets
 * operational-only, ADMINISTRATOR/OWNER get everything. Managers/accountants/
 * drivers get exactly what their job needs. Adjust per-organization later via
 * role management UI (Phase 2+); this is the sane default.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleNameLiteral, PermissionKey[]> = {
  CUSTOMER: [],
  STAFF: [PERMISSIONS.ORDER_MANAGE, PERMISSIONS.KITCHEN_VIEW, PERMISSIONS.BRANCH_VIEW],
  MANAGER: [
    PERMISSIONS.BRANCH_VIEW,
    PERMISSIONS.BRANCH_MANAGE,
    PERMISSIONS.USER_VIEW,
    PERMISSIONS.RESERVATION_MANAGE,
    PERMISSIONS.ORDER_MANAGE,
    PERMISSIONS.KITCHEN_VIEW,
    PERMISSIONS.DELIVERY_MANAGE,
    PERMISSIONS.CATERING_MANAGE,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.INVENTORY_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,
  ],
  ACCOUNTANT: [
    PERMISSIONS.FINANCE_VIEW,
    PERMISSIONS.FINANCE_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.CUSTOMER_VIEW,
  ],
  DRIVER: [PERMISSIONS.DELIVERY_MANAGE],
  OWNER: Object.values(PERMISSIONS),
  ADMINISTRATOR: Object.values(PERMISSIONS),
};

export const AUTH_COOKIE_NAME = 'rp_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
