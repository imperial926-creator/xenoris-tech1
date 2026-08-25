/**
 * Platform-admin auth constants — deliberately separate from
 * lib/auth/constants.ts (staff/owner) and lib/customer-auth/constants.ts
 * (CAPP mobile). This is the THIRD distinct auth audience in this codebase,
 * for the reason spelled out in schema.prisma's Phase 17 header comment:
 * the SaaS Owner / Platform Administrator is not a member of any
 * `organizationId` at all, so it cannot share a session shape with either
 * of the other two. Uses a cookie (like staff auth), not a bearer token
 * (like CAPP), because it's a browser-based admin console, not a mobile
 * client.
 */

export const PLATFORM_ADMIN_COOKIE_NAME = 'platform_admin_session';

// Deliberately shorter than the 7-day staff session (SESSION_TTL_SECONDS in
// lib/auth/constants.ts) — this account can view masked settlement
// information, change the live payment gateway configuration, and issue
// refunds across every restaurant on the platform, so it gets a tighter
// blast radius if a session token is ever compromised.
export const PLATFORM_ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours
