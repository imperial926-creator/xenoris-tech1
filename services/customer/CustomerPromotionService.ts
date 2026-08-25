import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError } from '@/lib/utils/api-error';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { PromotionService, deriveEffectiveStatus } from '@/services/promotions/PromotionService';
import type { ValidatePromoCodeInput, ListMyPromotionsQueryInput } from '@/lib/validation/promotion';

/**
 * CAPP Phase 8 — the customer app's half of promotions (spec § 23-25). Two
 * jobs: browsing/claiming (this class's `list*`/`get`/`claim`) and a
 * checkout-time preview (`previewDiscount`) the mobile app calls before
 * placing an order so the diner sees the discount *before* committing —
 * the actual, authoritative discount is always recomputed again inside
 * `OrderService.createOrder` itself (see that method's own comment); this
 * preview is informational only, same "never trust a client-submitted
 * total" boundary every other pricing path in this codebase already draws.
 */
export class CustomerPromotionService {
  /** Spec § 23's "Active promotions" — publicly browsable, no auth required (an anonymous diner looking at the menu should still see what's on offer). */
  static async listActive(publicCode: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const promotions = await prisma.promotion.findMany({
      where: { organizationId, status: { in: ['SCHEDULED', 'ACTIVE'] } },
      orderBy: { startAt: 'asc' },
    });
    const now = new Date();
    return {
      active: promotions.filter((p) => deriveEffectiveStatus(p, now) === 'ACTIVE'),
      upcoming: promotions.filter((p) => deriveEffectiveStatus(p, now) === 'SCHEDULED'),
    };
  }

  static async get(publicCode: string, promotionId: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const promotion = await prisma.promotion.findFirst({ where: { id: promotionId, organizationId, status: { not: 'DRAFT' } } });
    if (!promotion) throw new NotFoundError('Promotion');
    return promotion;
  }

  /**
   * Spec § 23's "Personalized offers"/"Saved offers"/"Expired offers" —
   * every `CustomerPromotion` this diner has ever claimed or redeemed at
   * this restaurant, grouped by the promotion's own effective status.
   * Requires a signed-in diner (there is nothing to "save" anonymously).
   */
  static async listMine(publicCode: string, customerAccountId: string, query: ListMyPromotionsQueryInput) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const claims = await prisma.customerPromotion.findMany({
      where: { organizationId, customerAccountId },
      include: { promotion: true },
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
    });
    const now = new Date();
    return claims.map((claim) => ({
      ...claim,
      effectiveStatus: deriveEffectiveStatus(claim.promotion, now),
    }));
  }

  static async claim(publicCode: string, customerAccountId: string, promotionId: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    // Ensures this diner has a CRM profile at this restaurant (same
    // lazy-link-on-first-interaction pattern every other customer-facing
    // write in this codebase already uses) — not itself required for the
    // claim row (which is keyed by customerAccountId, not customerId), but
    // keeps "this diner has interacted with this restaurant" consistent.
    await CustomerAccountService.getOrCreateCustomerProfile(organizationId, customerAccountId);
    return PromotionService.claim(organizationId, customerAccountId, promotionId);
  }

  /**
   * Checkout-time discount preview — see this class's header comment for
   * why the number shown here is informational, not authoritative.
   */
  static async previewDiscount(publicCode: string, customerAccountId: string, input: ValidatePromoCodeInput) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await CustomerAccountService.getOrCreateCustomerProfile(organizationId, customerAccountId);

    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: input.menuItemIds }, organizationId },
      select: { id: true, categoryId: true, price: true },
    });

    const preview = await PromotionService.validateAndPreviewDiscount(organizationId, input.promoCode, {
      orderType: input.orderType,
      subtotal: new Prisma.Decimal(input.subtotal),
      deliveryFee: new Prisma.Decimal(0),
      // Per-unit price, not a real line total (this preview has no
      // quantities/variants/modifiers — see this class's header comment on
      // why that's fine for an informational-only number).
      items: menuItems.map((m) => ({ menuItemId: m.id, categoryId: m.categoryId, lineTotal: new Prisma.Decimal(m.price as never) })),
      customerId: customer.id,
    });
    return {
      promotionId: preview.promotion.id,
      title: preview.promotion.title,
      discountAmount: preview.discountAmount.toFixed(2),
      waivesDelivery: preview.waiveDeliveryFee,
    };
  }
}
