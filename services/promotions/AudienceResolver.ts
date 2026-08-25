import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { ConflictError } from '@/lib/utils/api-error';
import { CustomerService } from '@/services/crm/CustomerService';
import { CUSTOMER_SEGMENTS, type CustomerSegment } from '@/lib/crm/rfm';
import type { PromotionAudienceType } from '@prisma/client';

/**
 * CAPP Phase 8 — spec § 19 "Promotion targeting" / § 32 "campaign rule
 * engine." A table-driven resolver, not a natural-language/DSL rule parser:
 * spec § 32's own worked example ("customer.last_order_date < today - 30
 * days AND customer.marketing_opt_in = true") is exactly what
 * `INACTIVE_DAYS` below evaluates — this is a real, extensible (add one
 * entry to `RESOLVERS` for a new targeting rule) implementation of that
 * requirement, just not a full expression-language authoring UI, which
 * nothing in this codebase has infrastructure for and no phase's spec
 * section asks for by name.
 *
 * Every resolver answers strictly from data this platform already has
 * (`Customer`, `Order`, `Reservation`, `CateringInquiry`, the Phase 8 RFM
 * segmentation, and — as of CAPP Phase 10 — `LoyaltyAccount`, which that
 * phase built for its own points/tier feature rather than for targeting,
 * `LOYALTY_TIER` just reads it) — no tracking table built solely for
 * audience resolution, matching architecture.md § 5's original "no new
 * tracking table needed" call.
 * Every resolver is also scoped to `Customer.customerAccountId != null`:
 * only a customer with an app account can ever be targeted by an in-app/
 * push campaign, so a walk-in with no account is correctly never included,
 * not silently mismatched.
 *
 * Opt-out (spec § 26 "do not allow marketing messages if the customer has
 * opted out") is enforced centrally in `resolveAudience`, not per-resolver —
 * every resolver returns candidates; opted-out candidates are filtered
 * afterward so no individual resolver can accidentally skip that check.
 */

export interface AudienceMember {
  customerAccountId: string;
  reason: string;
}

interface ResolverContext {
  organizationId: string;
  audienceParams: Record<string, unknown> | null;
}

type Resolver = (ctx: ResolverContext) => Promise<AudienceMember[]>;

/** Every Customer row with an app account linked, for org-wide targeting. */
async function candidatesWithAccount(organizationId: string) {
  return prisma.customer.findMany({
    where: { organizationId, customerAccountId: { not: null } },
    select: { id: true, customerAccountId: true },
  });
}

async function bySegment(organizationId: string, matches: (segment: CustomerSegment) => boolean, reasonPrefix: string): Promise<AudienceMember[]> {
  const candidates = await candidatesWithAccount(organizationId);
  // CAPP Phase 12 hardening (performance audit): this used to call
  // CustomerService.getAnalytics once per candidate — 6 sequential queries
  // each, i.e. ~6N queries for an N-customer org, all before a campaign
  // send's own transaction even opened. CustomerService.getRfmBatch computes
  // the same segment classification for every candidate in 3 queries total.
  // See that method's own comment for the batching approach.
  const rfmByCustomer = await CustomerService.getRfmBatch(organizationId, candidates.map((c) => c.id));
  const members: AudienceMember[] = [];
  for (const candidate of candidates) {
    const rfm = rfmByCustomer.get(candidate.id);
    if (!rfm) continue;
    if (matches(rfm.segment)) {
      members.push({ customerAccountId: candidate.customerAccountId!, reason: `${reasonPrefix}: segment ${rfm.segment}` });
    }
  }
  return members;
}

async function byOrderType(organizationId: string, type: 'DELIVERY' | 'TAKEOUT', reason: string): Promise<AudienceMember[]> {
  const rows = await prisma.customer.findMany({
    where: {
      organizationId,
      customerAccountId: { not: null },
      orders: { some: { organizationId, type, status: { not: 'CANCELLED' } } },
    },
    select: { customerAccountId: true },
  });
  return rows.map((r) => ({ customerAccountId: r.customerAccountId!, reason }));
}

const RESOLVERS: Record<PromotionAudienceType, Resolver> = {
  ALL: async ({ organizationId }) => {
    const candidates = await candidatesWithAccount(organizationId);
    return candidates.map((c) => ({ customerAccountId: c.customerAccountId!, reason: 'All customers with an app account' }));
  },
  NEW: ({ organizationId }) => bySegment(organizationId, (s) => s === 'NEW', 'New customer'),
  RETURNING: ({ organizationId }) => bySegment(organizationId, (s) => s === 'RETURNING', 'Returning customer'),
  // Documented mapping decision: spec's "LOYAL CUSTOMERS" audience maps to
  // this build's existing RFM segments that mean the same thing (frequent
  // and/or high-value, not merely "not new") — VIP and REGULAR — rather
  // than the not-yet-built points-tier system (that's LOYALTY_TIER below).
  LOYAL: ({ organizationId }) => bySegment(organizationId, (s) => s === 'VIP' || s === 'REGULAR', 'Loyal customer'),
  INACTIVE: ({ organizationId }) => bySegment(organizationId, (s) => s === 'INACTIVE', 'Inactive customer'),
  INACTIVE_DAYS: async ({ organizationId, audienceParams }) => {
    const days = Number(audienceParams?.days);
    if (!Number.isFinite(days) || days <= 0) {
      throw new ConflictError('INACTIVE_DAYS audience requires a positive audienceParams.days value.');
    }
    const candidates = await candidatesWithAccount(organizationId);
    // CAPP Phase 12 hardening — same batching as bySegment above.
    const rfmByCustomer = await CustomerService.getRfmBatch(organizationId, candidates.map((c) => c.id));
    const members: AudienceMember[] = [];
    for (const candidate of candidates) {
      const rfm = rfmByCustomer.get(candidate.id);
      // No transactions ever, or last transaction older than the threshold —
      // both read as "hasn't ordered in at least `days` days."
      if (!rfm || rfm.recencyDays === null || rfm.recencyDays >= days) {
        members.push({
          customerAccountId: candidate.customerAccountId!,
          reason: `No order/catering transaction in ${days}+ days`,
        });
      }
    }
    return members;
  },
  ORDERED_ITEMS: async ({ organizationId, audienceParams }) => {
    const menuItemIds = Array.isArray(audienceParams?.menuItemIds) ? (audienceParams!.menuItemIds as unknown[]).filter((v): v is string => typeof v === 'string') : [];
    if (menuItemIds.length === 0) {
      throw new ConflictError('ORDERED_ITEMS audience requires a non-empty audienceParams.menuItemIds array.');
    }
    const rows = await prisma.customer.findMany({
      where: {
        organizationId,
        customerAccountId: { not: null },
        orders: { some: { organizationId, items: { some: { menuItemId: { in: menuItemIds } } } } },
      },
      select: { customerAccountId: true },
    });
    return rows.map((r) => ({ customerAccountId: r.customerAccountId!, reason: 'Ordered a targeted menu item' }));
  },
  MADE_RESERVATIONS: async ({ organizationId }) => {
    const rows = await prisma.customer.findMany({
      where: { organizationId, customerAccountId: { not: null }, reservations: { some: { organizationId, status: { notIn: ['CANCELLED', 'NO_SHOW'] } } } },
      select: { customerAccountId: true },
    });
    return rows.map((r) => ({ customerAccountId: r.customerAccountId!, reason: 'Has made a reservation' }));
  },
  ORDERED_DELIVERY: ({ organizationId }) => byOrderType(organizationId, 'DELIVERY', 'Has ordered delivery'),
  ORDERED_TAKEOUT: ({ organizationId }) => byOrderType(organizationId, 'TAKEOUT', 'Has ordered take-out'),
  BOOKED_CATERING: async ({ organizationId }) => {
    const rows = await prisma.customer.findMany({
      where: { organizationId, customerAccountId: { not: null }, cateringInquiries: { some: { organizationId } } },
      select: { customerAccountId: true },
    });
    return rows.map((r) => ({ customerAccountId: r.customerAccountId!, reason: 'Has booked/inquired about catering' }));
  },
  LOCATION: async ({ organizationId, audienceParams }) => {
    const query = typeof audienceParams?.query === 'string' ? audienceParams.query.trim() : '';
    if (!query) throw new ConflictError('LOCATION audience requires a non-empty audienceParams.query string (city or province).');
    // Best-effort text match against a customer's saved address — the only
    // location data this platform has anywhere (no geo/lat-lng fields
    // exist on Customer or CustomerAddress).
    const rows = await prisma.customer.findMany({
      where: {
        organizationId,
        customerAccountId: { not: null },
        addresses: { some: { OR: [{ city: { contains: query, mode: 'insensitive' } }, { province: { contains: query, mode: 'insensitive' } }] } },
      },
      select: { customerAccountId: true },
    });
    return rows.map((r) => ({ customerAccountId: r.customerAccountId!, reason: `Saved address matches "${query}"` }));
  },
  SEGMENT: async ({ organizationId, audienceParams }) => {
    const segment = audienceParams?.segment;
    if (typeof segment !== 'string' || !CUSTOMER_SEGMENTS.includes(segment as CustomerSegment)) {
      throw new ConflictError(`SEGMENT audience requires audienceParams.segment to be one of: ${CUSTOMER_SEGMENTS.join(', ')}.`);
    }
    return bySegment(organizationId, (s) => s === segment, `Segment ${segment}`);
  },
  // CAPP Phase 10 — real as of this phase. Matches `audienceParams.tier`
  // against `LoyaltyAccount.tier` directly (not `bySegment`'s RFM-based
  // candidates — a different, points-based notion of "loyal"). A
  // LoyaltyAccount only ever exists for a CustomerAccount that has already
  // earned or redeemed points at this organization (see
  // LoyaltyService.getOrCreateAccount), so every row here already implies
  // the same "has an app account at this org" scoping every other resolver
  // enforces via Customer.customerAccountId.
  LOYALTY_TIER: async ({ organizationId, audienceParams }) => {
    const tier = audienceParams?.tier;
    const validTiers = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
    if (typeof tier !== 'string' || !validTiers.includes(tier)) {
      throw new ConflictError(`LOYALTY_TIER audience requires audienceParams.tier to be one of: ${validTiers.join(', ')}.`);
    }
    const rows = await prisma.loyaltyAccount.findMany({
      where: { organizationId, tier: tier as 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' },
      select: { customerAccountId: true },
    });
    return rows.map((r) => ({ customerAccountId: r.customerAccountId, reason: `Loyalty tier ${tier}` }));
  },
};

/**
 * Resolves a campaign's audience, filtering out anyone who has opted out of
 * promotional notifications (spec § 26) or the whole account's
 * `marketingOptIn` flag — enforced here, once, regardless of which resolver
 * produced the candidate list, so no individual audience type can
 * accidentally bypass it. Deduplicates in case a candidate somehow matched
 * more than once (not expected from any single resolver today, but cheap
 * insurance against a future resolver that queries multiple ways).
 */
export async function resolveAudience(
  organizationId: string,
  audienceType: PromotionAudienceType,
  audienceParams: Record<string, unknown> | null,
): Promise<AudienceMember[]> {
  const resolver = RESOLVERS[audienceType];
  // Unreachable through the Zod-validated API surface (audienceType is
  // itself a z.enum(PROMOTION_AUDIENCE_TYPES) restricted to RESOLVERS' own
  // keys) — this guard exists only because indexing a Record by a type this
  // sandbox's unresolved `@prisma/client` types can't narrow to a closed
  // union trips `noUncheckedIndexedAccess`; a clear error beats a raw
  // "resolver is not a function" crash if it's ever wrong.
  if (!resolver) throw new ConflictError(`Unknown audience type: ${audienceType}.`);
  const candidates = await resolver({ organizationId, audienceParams });

  const accountIds = [...new Set(candidates.map((c) => c.customerAccountId))];
  if (accountIds.length === 0) return [];

  const optedIn = await prisma.customerAccount.findMany({
    where: {
      id: { in: accountIds },
      marketingOptIn: true,
      OR: [{ notificationPreference: null }, { notificationPreference: { allowPromotional: true } }],
    },
    select: { id: true },
  });
  const optedInIds = new Set(optedIn.map((a) => a.id));

  const seen = new Set<string>();
  const result: AudienceMember[] = [];
  for (const candidate of candidates) {
    if (!optedInIds.has(candidate.customerAccountId) || seen.has(candidate.customerAccountId)) continue;
    seen.add(candidate.customerAccountId);
    result.push(candidate);
  }
  return result;
}
