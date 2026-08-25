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
  TABLE_VIEW: 'table:view',
  TABLE_MANAGE: 'table:manage',
  MENU_VIEW: 'menu:view',
  MENU_MANAGE: 'menu:manage',
  RESERVATION_VIEW: 'reservation:view',
  RESERVATION_MANAGE: 'reservation:manage',
  ORDER_MANAGE: 'order:manage',
  KITCHEN_VIEW: 'kitchen:view',
  DELIVERY_MANAGE: 'delivery:manage',
  CATERING_MANAGE: 'catering:manage',
  CUSTOMER_VIEW: 'customer:view',
  CUSTOMER_MANAGE: 'customer:manage',
  INVENTORY_MANAGE: 'inventory:manage',
  FINANCE_VIEW: 'finance:view',
  FINANCE_MANAGE: 'finance:manage',
  REPORTS_VIEW: 'reports:view',
  ANALYTICS_VIEW: 'analytics:view',
  AUDIT_VIEW: 'audit:view',
  NOTIFICATION_VIEW: 'notification:view',
  // CAPP Phase 2 — customer mobile app. Separate from ORG_MANAGE: branding
  // (logo, colors, description, policies) is what the customer app
  // displays, edited far more casually/often than core org settings
  // (name/email/currency/timezone), and a MANAGER should reasonably be able
  // to update it without also holding ORG_MANAGE's broader authority.
  BRANDING_MANAGE: 'branding:manage',
  // CAPP Phase 8 — promotions/campaigns. One permission for both (like
  // CATERING_MANAGE covering inquiries/quotes/events/payments together) —
  // campaign management is inseparable from the promotion it targets.
  PROMOTION_MANAGE: 'promotion:manage',
  // Phase 17 — Platform Subscription Billing, restaurant-owner side only
  // (this org's OWN subscription to the SaaS platform — subscribing,
  // viewing payment history, updating the saved card). Distinct from
  // FINANCE_MANAGE/FINANCE_VIEW, which govern this restaurant's own
  // accounting of ITS diners' money, a completely different flow. There is
  // deliberately no permission constant here for the SaaS-Owner-side
  // config screens (payment gateway setup, cross-organization
  // reconciliation, refunds) — those are gated by PlatformAdmin auth
  // (lib/platform-admin/guard.ts), not this org-scoped RBAC system at all;
  // see schema.prisma's Phase 17 header comment for why.
  BILLING_VIEW: 'billing:view',
  BILLING_MANAGE: 'billing:manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_CATALOG: Array<{ key: PermissionKey; description: string }> = [
  { key: PERMISSIONS.ORG_MANAGE, description: 'Create/update organization settings' },
  { key: PERMISSIONS.BRANCH_MANAGE, description: 'Create/update/deactivate branches' },
  { key: PERMISSIONS.BRANCH_VIEW, description: 'View branch details' },
  { key: PERMISSIONS.USER_MANAGE, description: 'Invite/manage staff users and role assignments' },
  { key: PERMISSIONS.USER_VIEW, description: 'View staff user list' },
  { key: PERMISSIONS.ROLE_MANAGE, description: 'Manage roles and permission grants' },
  { key: PERMISSIONS.TABLE_VIEW, description: 'View table sections, tables, and status board' },
  { key: PERMISSIONS.TABLE_MANAGE, description: 'Create/update tables, sections, and table status' },
  { key: PERMISSIONS.MENU_VIEW, description: 'View menu categories, items, and modifiers' },
  { key: PERMISSIONS.MENU_MANAGE, description: 'Create/update menu categories, items, variants, and modifiers' },
  { key: PERMISSIONS.RESERVATION_VIEW, description: 'View reservations and table availability' },
  { key: PERMISSIONS.RESERVATION_MANAGE, description: 'Create/update/cancel reservations, record deposits' },
  { key: PERMISSIONS.ORDER_MANAGE, description: 'Manage orders (Phase 4)' },
  { key: PERMISSIONS.KITCHEN_VIEW, description: 'View kitchen display system (Phase 5)' },
  { key: PERMISSIONS.DELIVERY_MANAGE, description: 'Manage deliveries/drivers (Phase 6)' },
  { key: PERMISSIONS.CATERING_MANAGE, description: 'Manage catering inquiries/events (Phase 7)' },
  { key: PERMISSIONS.CUSTOMER_VIEW, description: 'View customer CRM records (Phase 8)' },
  { key: PERMISSIONS.CUSTOMER_MANAGE, description: 'Create/update customer profiles, addresses, preferences, notes, tags, reviews (Phase 8)' },
  { key: PERMISSIONS.INVENTORY_MANAGE, description: 'Manage inventory/purchasing (Phase 9)' },
  { key: PERMISSIONS.FINANCE_VIEW, description: 'View financial reports (Phase 10/11)' },
  { key: PERMISSIONS.FINANCE_MANAGE, description: 'Post/reverse journal entries (Phase 10)' },
  { key: PERMISSIONS.REPORTS_VIEW, description: 'Export reports (Phase 11+)' },
  { key: PERMISSIONS.ANALYTICS_VIEW, description: 'View owner analytics dashboards (Phase 12)' },
  { key: PERMISSIONS.AUDIT_VIEW, description: 'View audit logs' },
  { key: PERMISSIONS.NOTIFICATION_VIEW, description: 'View notification delivery history (Phase 14)' },
  { key: PERMISSIONS.BRANDING_MANAGE, description: 'Manage customer-app restaurant branding/profile (CAPP Phase 2)' },
  { key: PERMISSIONS.PROMOTION_MANAGE, description: 'Create/manage promotions and campaigns, view redemptions (CAPP Phase 8)' },
  { key: PERMISSIONS.BILLING_VIEW, description: "View this organization's own SaaS subscription, payment history, and invoices (Phase 17)" },
  { key: PERMISSIONS.BILLING_MANAGE, description: "Subscribe, change plan, and update the saved payment method for this organization's own SaaS subscription (Phase 17)" },
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
  STAFF: [
    PERMISSIONS.ORDER_MANAGE,
    PERMISSIONS.KITCHEN_VIEW,
    PERMISSIONS.BRANCH_VIEW,
    PERMISSIONS.TABLE_VIEW,
    // Staff change table status constantly during service (seat a walk-in,
    // mark a table cleaning) but do not edit the floor plan or menu pricing.
    PERMISSIONS.TABLE_MANAGE,
    PERMISSIONS.MENU_VIEW,
    // Front-of-house staff take and manage reservations (phone bookings,
    // walk-ins, seating, cancellations) as a core part of the job.
    PERMISSIONS.RESERVATION_VIEW,
    PERMISSIONS.RESERVATION_MANAGE,
    // Someone has to dispatch a ready delivery order to a driver — front
    // -of-house staff, not just managers, same reasoning as ORDER_MANAGE
    // above (Phase 6).
    PERMISSIONS.DELIVERY_MANAGE,
    // Taking a phone/walk-in order routinely means creating or updating a
    // customer profile, jotting a note ("allergic to peanuts"), or tagging
    // a preference — routine front-of-house data entry, unlike catering
    // (Phase 7), which stayed manager-only (Phase 8).
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.CUSTOMER_MANAGE,
  ],
  MANAGER: [
    PERMISSIONS.BRANCH_VIEW,
    PERMISSIONS.BRANCH_MANAGE,
    PERMISSIONS.USER_VIEW,
    PERMISSIONS.TABLE_VIEW,
    PERMISSIONS.TABLE_MANAGE,
    PERMISSIONS.MENU_VIEW,
    PERMISSIONS.MENU_MANAGE,
    PERMISSIONS.RESERVATION_VIEW,
    PERMISSIONS.RESERVATION_MANAGE,
    PERMISSIONS.ORDER_MANAGE,
    PERMISSIONS.KITCHEN_VIEW,
    PERMISSIONS.DELIVERY_MANAGE,
    PERMISSIONS.CATERING_MANAGE,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.CUSTOMER_MANAGE,
    PERMISSIONS.INVENTORY_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,
    // Managers are the ones who follow up when a guest says "I never got
    // my confirmation" — same operational-visibility reasoning as
    // ANALYTICS_VIEW above, scoped one level narrower than AUDIT_VIEW
    // (OWNER/ADMINISTRATOR only), since this is a communications log, not
    // a full change-history audit trail.
    PERMISSIONS.NOTIFICATION_VIEW,
    // Same "day-to-day operational setting, not core org identity" line as
    // BRANCH_MANAGE above — see BRANDING_MANAGE's own comment.
    PERMISSIONS.BRANDING_MANAGE,
    // Marketing/promotions is a manager-level call (pricing, discounting,
    // who gets targeted), same "stayed manager-only" line CATERING_MANAGE
    // already draws for STAFF above — see the STAFF block's own comment.
    PERMISSIONS.PROMOTION_MANAGE,
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
