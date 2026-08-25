import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';
import { isBranchOpenNow } from '@/lib/utils/business-hours';

/**
 * Public, unauthenticated restaurant lookup for the customer mobile app —
 * spec § 5 (QR/deep-link discovery) and § 9. Everything here reads
 * Organization + the Phase 1 RestaurantBranding row; nothing here requires
 * (or accepts) a customer session, since a diner must be able to view a
 * restaurant's public menu before they've registered.
 *
 * See docs/customer-app/architecture.md § 2 for why `Organization` is reused
 * as the tenant model rather than a new "Restaurant" table, and § 3 for why
 * `publicCode` (not the internal cuid) is what's exposed in URLs/QR codes.
 */
export class RestaurantDirectoryService {
  /**
   * Assigns the next `RST-000001`-style code, atomically incrementing the
   * single named PlatformSequence row — the exact upsert+increment pattern
   * InvoiceService.issueInvoice uses for invoice numbers (see that file),
   * just keyed by a fixed sequence name instead of per-branch.
   */
  static async allocatePublicCode(
    client: PrismaClient | Prisma.TransactionClient = prisma,
  ): Promise<string> {
    const sequence = await client.platformSequence.upsert({
      where: { name: 'restaurant_public_code' },
      create: { name: 'restaurant_public_code', lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    return `RST-${String(sequence.lastNumber).padStart(6, '0')}`;
  }

  /**
   * Looks up a restaurant by its public-facing code (from a QR code or deep
   * link) and returns what a not-yet-authenticated diner should see: name,
   * currency/timezone, branding, and — CAPP Phase 2 — location (address/
   * phone/opening hours) and a live OPEN/CLOSED status (spec § 8's
   * Restaurant Home Screen). Never internal settings, staff data, or
   * financials. White-label rule (spec § 64): every field here comes from
   * this organization's own branding row, never a hard-coded platform
   * brand.
   */
  static async getByPublicCode(publicCode: string) {
    const organization = await prisma.organization.findUnique({
      where: { publicCode },
      select: {
        id: true,
        publicCode: true,
        name: true,
        currency: true,
        timezone: true,
        branding: true,
      },
    });
    if (!organization) throw new NotFoundError('Restaurant');

    const branch = await this.resolvePrimaryBranch(organization.id);
    return {
      ...organization,
      location: branch
        ? {
            address: branch.address,
            phone: branch.phone,
            timezone: branch.timezone,
            openingHours: branch.openingHours,
            isOpenNow: isBranchOpenNow(branch, new Date()),
          }
        : null,
    };
  }

  /**
   * This base platform lets one Organization own multiple Branches (a
   * restaurant chain with several physical locations), but the customer-app
   * spec's entire model — one `restaurant_id`, one storefront, one set of
   * hours on the Home Screen (§ 8) — has no concept of a diner picking a
   * location. Rather than silently picking an arbitrary branch or guessing
   * at multi-location UX the spec never describes, this documents the
   * narrow Phase 2 decision explicitly: the organization's longest
   * -standing `ACTIVE` branch is treated as the storefront the customer app
   * represents (falling back to the longest-standing branch of any status,
   * so a newly-registered organization with a branch still in setup isn't
   * hidden entirely). This covers the common case this platform's own
   * onboarding produces — one organization, one branch — cleanly; true
   * multi-location customer-app support (a branch/location picker) is out
   * of scope unless a future phase adds it — it is not in the spec's own
   * 12-phase sequence (§ 62).
   *
   * CAPP Phase 3: widened from `private` to a plain `static` — reservations
   * need the actual `branchId` (tables/availability are branch-scoped in
   * the base platform), not just the address/hours fields `getByPublicCode`
   * projects out of it. `CustomerReservationService` calls this directly
   * rather than duplicating the "longest-standing ACTIVE branch" decision.
   */
  static async resolvePrimaryBranch(organizationId: string) {
    const active = await prisma.branch.findFirst({
      where: { organizationId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (active) return active;
    return prisma.branch.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * CAPP Phase 4: shared "resolve a diner-facing `publicCode` to
   * `{organizationId, branchId}`" helper — extracted out of
   * `CustomerReservationService`'s own private `resolveStorefront` (Phase
   * 3) once `CustomerOrderService` needed the exact same resolution, rather
   * than letting a third near-identical copy land in a future phase.
   * Throws `ConflictError` if the organization has no branch configured
   * yet — every customer-facing service method that needs a branch calls
   * this first.
   */
  static async resolveStorefront(publicCode: string): Promise<{ organizationId: string; branchId: string }> {
    const restaurant = await this.getByPublicCode(publicCode);
    const branch = await this.resolvePrimaryBranch(restaurant.id);
    if (!branch) {
      throw new ConflictError('This restaurant has not configured a branch yet.');
    }
    return { organizationId: restaurant.id, branchId: branch.id };
  }

  /**
   * Same lookup, by internal id — used server-side once a route's dynamic
   * segment has already been resolved via getByPublicCode, or by other
   * server code that already holds an organizationId (e.g. linking a
   * CustomerAccount to a per-org Customer profile).
   */
  static async requireOrganization(organizationId: string) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, publicCode: true, name: true, currency: true, timezone: true },
    });
    if (!organization) throw new NotFoundError('Restaurant');
    return organization;
  }

  /** Staff-facing read of the current branding row (null if never configured). */
  static async getBranding(organizationId: string) {
    await this.requireOrganization(organizationId);
    return prisma.restaurantBranding.findUnique({ where: { organizationId } });
  }

  /**
   * Creates (or updates) the one-row-per-Organization branding record — the
   * CAPP Phase 2 staff-facing branding editor's write path
   * (`app/api/branding/route.ts`, gated on `branding:manage`).
   */
  static async upsertBranding(
    organizationId: string,
    input: {
      logoUrl?: string | null;
      coverImageUrl?: string | null;
      primaryColor?: string | null;
      secondaryColor?: string | null;
      accentColor?: string | null;
      description?: string | null;
      website?: string | null;
      // Deliberately not `| null` (unlike the other fields here) — Json
      // columns need Prisma's JsonNull sentinel, not plain `null`, to clear
      // them; the validation schema (lib/validation/branding.ts) only ever
      // sends "omit" or a real object, sidestepping that entirely.
      socialLinks?: Record<string, string>;
      reservationPolicy?: string | null;
      cancellationPolicy?: string | null;
      deliveryPolicy?: string | null;
    },
    actorUserId: string,
  ) {
    await this.requireOrganization(organizationId);
    const previous = await prisma.restaurantBranding.findUnique({ where: { organizationId } });

    return prisma.$transaction(async (tx) => {
      const branding = await tx.restaurantBranding.upsert({
        where: { organizationId },
        create: { organizationId, ...input },
        update: input,
      });
      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: previous ? 'branding.update' : 'branding.create',
        entityType: 'RestaurantBranding',
        entityId: branding.id,
        previousValue: previous ?? undefined,
        newValue: branding,
      });
      return branding;
    });
  }

  /**
   * Public menu — categories -> items -> variants/modifier groups, filtered
   * to what a diner should actually be able to order right now (active
   * category, active + available item). Shape mirrors MenuService's staff
   * read paths but is intentionally a separate query: the staff menu view
   * includes inactive/unavailable items (so staff can re-enable them), the
   * public one must not.
   */
  static async getPublicMenu(organizationId: string) {
    await this.requireOrganization(organizationId);
    return prisma.menuCategory.findMany({
      where: { organizationId, active: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        displayOrder: true,
        items: {
          where: { active: true, available: true },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            imageUrl: true,
            preparationTimeMinutes: true,
            variants: {
              where: { active: true },
              orderBy: { displayOrder: 'asc' },
              select: { id: true, name: true, price: true },
            },
            modifierGroups: {
              select: {
                modifierGroup: {
                  select: {
                    id: true,
                    name: true,
                    selectionType: true,
                    required: true,
                    minSelect: true,
                    maxSelect: true,
                    modifiers: {
                      where: { active: true },
                      orderBy: { displayOrder: 'asc' },
                      select: { id: true, name: true, priceDelta: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * CAPP Phase 10 — spec § 39 "Upselling": the staff-authored recommendation
   * row(s) for one menu item, filtered to `active: true` and to a still-
   * orderable recommended item (same active+available gate `getPublicMenu`
   * applies) — a diner should never see "Add Fries" for fries that are
   * currently 86'd.
   */
  static async getMenuItemRecommendations(organizationId: string, menuItemId: string) {
    return prisma.menuItemRecommendation.findMany({
      where: {
        organizationId,
        menuItemId,
        active: true,
        recommendedMenuItem: { active: true, available: true },
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        label: true,
        bundlePrice: true,
        recommendedMenuItem: { select: { id: true, name: true, description: true, price: true, imageUrl: true } },
      },
    });
  }

  /**
   * CAPP Phase 10 — spec § 45 Home Screen "Popular products." Computed from
   * real sales (a COUNT/SUM over `OrderItem` for non-cancelled orders in the
   * trailing window), not restaurant-curated like `MenuItemRecommendation`
   * above — a real, data-backed complement to that manually-configured
   * feature rather than a duplicate of it, matching this codebase's "no
   * fake data" discipline (a "Popular" row with nothing actually ordered
   * yet returns empty, not a fabricated ranking).
   */
  static async getPopularItems(organizationId: string, limit = 10, sinceDays = 30) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const grouped = await prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: {
        order: { organizationId, status: { not: 'CANCELLED' }, createdAt: { gte: since } },
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: limit,
    });
    if (grouped.length === 0) return [];

    const menuItemIds = grouped.map((g) => g.menuItemId);
    const items = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, organizationId, active: true, available: true },
      select: { id: true, name: true, description: true, price: true, imageUrl: true },
    });
    const itemById = new Map<string, (typeof items)[number]>(items.map((i) => [i.id, i]));

    return grouped
      .map((g) => ({ menuItem: itemById.get(g.menuItemId), orderCount: g._sum.quantity ?? 0 }))
      .filter((g): g is { menuItem: NonNullable<typeof g.menuItem>; orderCount: number } => Boolean(g.menuItem));
  }
}
