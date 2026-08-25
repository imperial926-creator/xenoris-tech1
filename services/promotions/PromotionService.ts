import 'server-only';
import { Prisma } from '@prisma/client';
import type { Promotion, PromotionStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { emitRealtimeEvent, writeCustomerNotification } from '@/lib/realtime/emit';
import { LoyaltyService } from '@/services/loyalty/LoyaltyService';
import { minutesSinceMidnightInTimezone, parseHHMM } from '@/lib/utils/business-hours';
import type { CreatePromotionInput, ListPromotionsQueryInput, UpdatePromotionInput } from '@/lib/validation/promotion';

type Tx = Prisma.TransactionClient;

/**
 * CAPP Phase 8 — spec § 17-18, § 24-25. See docs/customer-app/architecture.md
 * § 17 for the full implementation record. This class owns:
 *
 *   1. Promotion CRUD (staff-facing, `app/api/promotions/**`).
 *   2. Status lifecycle (`ALLOWED_TRANSITIONS`/`deriveEffectiveStatus`) — see
 *      the comment on those two below for how "staff-set status" and
 *      "date window" combine into what's actually redeemable right now,
 *      without a background scheduler.
 *   3. Redemption: `validateAndPreviewDiscount` (read-only, called by
 *      `CustomerOrderService`/`OrderService` before opening a transaction)
 *      and `recordRedemption` (the atomic, race-safe part, called from
 *      inside `OrderService.createOrder`'s own transaction).
 *   4. Claiming (`claim`) — spec § 24's in-app "SAVE OFFER"/"CLAIM OFFER".
 *
 * `PromotionCampaign` CRUD/sending lives in the sibling
 * `PromotionCampaignService` — audience targeting is a big enough concern
 * (see `AudienceResolver.ts`) to keep out of this already-large file.
 */

// Spec § 28's six statuses. DRAFT/CANCELLED/ENDED are terminal-ish (ENDED
// can still be reached from PAUSED directly — a paused promotion a
// restaurant decides not to resume doesn't need to pass back through
// ACTIVE first). SCHEDULED and ACTIVE are functionally identical from here
// down — see `deriveEffectiveStatus` — both just mean "published; let the
// dates decide," offered as two distinct choices only because spec § 28
// lists them separately and a restaurant may find "Scheduled" clearer
// language for a promotion that hasn't started yet.
const ALLOWED_TRANSITIONS: Record<PromotionStatus, PromotionStatus[]> = {
  DRAFT: ['SCHEDULED', 'ACTIVE', 'CANCELLED'],
  SCHEDULED: ['ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED'],
  ACTIVE: ['PAUSED', 'ENDED', 'CANCELLED'],
  PAUSED: ['ACTIVE', 'SCHEDULED', 'ENDED', 'CANCELLED'],
  ENDED: [],
  CANCELLED: [],
};

export type EffectivePromotionStatus = PromotionStatus;

/**
 * The status that actually governs redeemability/visibility right now,
 * computed from the stored `status` plus `startAt`/`endAt` — not stored
 * itself. DRAFT/PAUSED/CANCELLED/ENDED are explicit staff states and pass
 * through unchanged (a PAUSED promotion stays paused even if its date
 * window says it should be live — that's the point of pausing one).
 * SCHEDULED/ACTIVE both resolve purely from the clock: this is what lets
 * "Schedule for later" (spec § 20) actually start and stop on time without
 * a background job ever running (same "no separate always-on process"
 * constraint the real-time design already lives with — see
 * architecture.md § 6) — every place that cares (redemption validation,
 * the customer app's promotions list) calls this function fresh, so the
 * date boundary is exact even though nothing ever writes ENDED for a
 * promotion whose endAt quietly passed.
 */
export function deriveEffectiveStatus(
  promotion: Pick<Promotion, 'status' | 'startAt' | 'endAt'>,
  now: Date,
): EffectivePromotionStatus {
  if (promotion.status === 'DRAFT' || promotion.status === 'PAUSED' || promotion.status === 'CANCELLED' || promotion.status === 'ENDED') {
    return promotion.status;
  }
  if (now < promotion.startAt) return 'SCHEDULED';
  if (promotion.endAt && now > promotion.endAt) return 'ENDED';
  return 'ACTIVE';
}

/** Whether `startTimeOfDay`/`endTimeOfDay` (if set) currently permit redemption, evaluated in the organization's own timezone — same primitives `isBranchOpenNow` uses. No window configured at all always passes. */
function withinTimeOfDayWindow(promotion: Pick<Promotion, 'startTimeOfDay' | 'endTimeOfDay'>, timezone: string, now: Date): boolean {
  if (!promotion.startTimeOfDay || !promotion.endTimeOfDay) return true;
  const openMinutes = parseHHMM(promotion.startTimeOfDay);
  const closeMinutes = parseHHMM(promotion.endTimeOfDay);
  if (openMinutes === null || closeMinutes === null) return true;
  const nowMinutes = minutesSinceMidnightInTimezone(now, timezone);
  if (closeMinutes > openMinutes) return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
  // Crosses midnight (e.g. 22:00-02:00) — valid outside the gap, not inside it.
  return nowMinutes >= openMinutes || nowMinutes < closeMinutes;
}

export interface RedemptionOrderContext {
  orderType: 'DINE_IN' | 'TAKEOUT' | 'DELIVERY';
  subtotal: Prisma.Decimal;
  deliveryFee: Prisma.Decimal;
  items: Array<{ menuItemId: string; categoryId: string; lineTotal: Prisma.Decimal }>;
  customerId: string;
}

export interface DiscountPreview {
  promotion: Promotion;
  discountAmount: Prisma.Decimal;
  /** FREE_DELIVERY only — see OrderService's integration comment for why this is a separate signal from discountAmount rather than folded into it. */
  waiveDeliveryFee: boolean;
}

export class PromotionService {
  // --- staff CRUD -----------------------------------------------------------

  static async list(organizationId: string, query: ListPromotionsQueryInput) {
    return prisma.promotion.findMany({
      where: { organizationId, status: query.status },
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
    });
  }

  static async get(organizationId: string, promotionId: string): Promise<Promotion> {
    const promotion = await prisma.promotion.findFirst({ where: { id: promotionId, organizationId } });
    if (!promotion) throw new NotFoundError('Promotion');
    return promotion;
  }

  static async create(organizationId: string, input: CreatePromotionInput, actorUserId: string): Promise<Promotion> {
    if (input.promoCode) await this.assertCodeAvailable(organizationId, input.promoCode);

    const promotion = await prisma.$transaction(async (tx) => {
      const created = await tx.promotion.create({
        data: {
          organizationId,
          title: input.title,
          description: input.description,
          imageUrl: input.imageUrl,
          promoCode: input.promoCode,
          discountType: input.discountType,
          discountValue: input.discountValue,
          minimumOrderValue: input.minimumOrderValue,
          maximumDiscount: input.maximumDiscount,
          startAt: this.parseDate(input.startAt, 'startAt'),
          endAt: input.endAt ? this.parseDate(input.endAt, 'endAt') : undefined,
          startTimeOfDay: input.startTimeOfDay,
          endTimeOfDay: input.endTimeOfDay,
          eligibleServices: input.eligibleServices as Prisma.InputJsonValue,
          eligibleMenuItemIds: input.eligibleMenuItemIds,
          eligibleCategoryIds: input.eligibleCategoryIds,
          usageLimit: input.usageLimit,
          customerUsageLimit: input.customerUsageLimit,
          terms: input.terms,
          loyaltyPointsCost: input.loyaltyPointsCost,
        },
      });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId, action: 'promotion.create', entityType: 'Promotion', entityId: created.id, newValue: created,
      });
      await emitRealtimeEvent(tx, {
        organizationId, type: 'PromotionCreated', payload: { promotionId: created.id, title: created.title, status: created.status },
      });
      return created;
    });
    return promotion;
  }

  static async update(organizationId: string, promotionId: string, input: UpdatePromotionInput, actorUserId: string): Promise<Promotion> {
    const existing = await this.get(organizationId, promotionId);
    if (input.promoCode && input.promoCode !== existing.promoCode) await this.assertCodeAvailable(organizationId, input.promoCode);

    const promotion = await prisma.$transaction(async (tx) => {
      const updated = await tx.promotion.update({
        where: { id: promotionId },
        data: {
          title: input.title,
          description: input.description,
          imageUrl: input.imageUrl,
          promoCode: input.promoCode,
          discountType: input.discountType,
          discountValue: input.discountValue,
          minimumOrderValue: input.minimumOrderValue,
          maximumDiscount: input.maximumDiscount,
          startAt: input.startAt ? this.parseDate(input.startAt, 'startAt') : undefined,
          endAt: input.endAt ? this.parseDate(input.endAt, 'endAt') : undefined,
          startTimeOfDay: input.startTimeOfDay,
          endTimeOfDay: input.endTimeOfDay,
          eligibleServices: input.eligibleServices ? (input.eligibleServices as Prisma.InputJsonValue) : undefined,
          eligibleMenuItemIds: input.eligibleMenuItemIds,
          eligibleCategoryIds: input.eligibleCategoryIds,
          usageLimit: input.usageLimit,
          customerUsageLimit: input.customerUsageLimit,
          terms: input.terms,
          loyaltyPointsCost: input.loyaltyPointsCost,
        },
      });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId, action: 'promotion.update', entityType: 'Promotion', entityId: updated.id, previousValue: existing, newValue: updated,
      });
      await emitRealtimeEvent(tx, {
        organizationId, type: 'PromotionUpdated', payload: { promotionId: updated.id, title: updated.title, status: updated.status },
      });
      return updated;
    });
    return promotion;
  }

  static async updateStatus(organizationId: string, promotionId: string, status: PromotionStatus, actorUserId: string): Promise<Promotion> {
    const existing = await this.get(organizationId, promotionId);
    if (existing.status === status) return existing;
    // `?? []` guards noUncheckedIndexedAccess — see AudienceResolver.
    // resolveAudience's resolver-lookup comment for why this is
    // unreachable in practice (PromotionStatus is closed, every key is
    // present above).
    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(status)) {
      throw new ConflictError(`Cannot move a promotion from ${existing.status} to ${status}.`);
    }

    const promotion = await prisma.$transaction(async (tx) => {
      const updated = await tx.promotion.update({ where: { id: promotionId }, data: { status } });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId, action: 'promotion.status', entityType: 'Promotion', entityId: promotionId, previousValue: { status: existing.status }, newValue: { status },
      });
      if (status === 'ACTIVE') {
        await emitRealtimeEvent(tx, { organizationId, type: 'PromotionStarted', payload: { promotionId, title: updated.title } });
      } else if (status === 'ENDED' || status === 'CANCELLED') {
        await emitRealtimeEvent(tx, { organizationId, type: 'PromotionEnded', payload: { promotionId, title: updated.title, status } });
      }
      return updated;
    });
    return promotion;
  }

  // --- customer-facing: claim -------------------------------------------

  /**
   * Spec § 24 "SAVE OFFER"/"CLAIM OFFER". Idempotent: claiming an already-
   * AVAILABLE-or-CLAIMED promotion just returns its current row rather than
   * erroring — a diner tapping "Save" twice (a double-tap, a retried
   * request) is not a mistake worth surfacing as one. Claiming a REDEEMED
   * promotion with no remaining customerUsageLimit uses is rejected — see
   * "Prevent unauthorized reuse" (spec § 24).
   */
  static async claim(organizationId: string, customerAccountId: string, promotionId: string) {
    const promotion = await this.get(organizationId, promotionId);
    const effective = deriveEffectiveStatus(promotion, new Date());
    if (effective !== 'ACTIVE' && effective !== 'SCHEDULED') {
      throw new ConflictError('This promotion is no longer available to claim.');
    }

    const existing = await prisma.customerPromotion.findUnique({
      where: { customerAccountId_promotionId: { customerAccountId, promotionId } },
    });
    if (existing) {
      if (existing.status === 'REDEEMED' && !this.hasRemainingCustomerUses(promotion, existing.timesRedeemed)) {
        throw new ConflictError('You have already used this promotion.');
      }
      return existing;
    }

    const claimed = await prisma.customerPromotion.create({
      data: { customerAccountId, organizationId, promotionId, status: 'AVAILABLE', claimedAt: new Date() },
    });

    // CAPP Phase 9 — spec § 27 Notification Center. No matching spec § 43
    // business event exists for "claimed an offer" (see
    // lib/realtime/emit.ts's REALTIME_EVENT_TYPES header) — this calls
    // writeCustomerNotification directly rather than emitRealtimeEvent,
    // which still fires the generic NotificationCreated real-time signal.
    // Best-effort: a notification failure must never undo an already-
    // recorded claim, same "never let a side effect roll back the real
    // write" principle NotificationService's class header documents for
    // transactional notifications.
    try {
      await writeCustomerNotification(prisma, organizationId, customerAccountId, {
        category: 'PROMOTION',
        title: 'Offer saved',
        message: `"${promotion.title}" is saved to My Offers — redeem it at checkout.`,
        deepLink: 'Promotions',
        relatedEntityType: 'Promotion',
        relatedEntityId: promotionId,
      });
    } catch {
      // Never let a notification-center write failure undo a successful
      // claim — the claim itself already committed above.
    }

    return claimed;
  }

  private static hasRemainingCustomerUses(promotion: Pick<Promotion, 'customerUsageLimit'>, timesRedeemed: number): boolean {
    return promotion.customerUsageLimit == null || timesRedeemed < promotion.customerUsageLimit;
  }

  // --- redemption: preview (read-only, pre-transaction) -------------------

  /**
   * Validates a promo code against a not-yet-placed order and computes the
   * discount it would apply — called by `CustomerOrderService`/
   * `OrderService.createOrder` *before* opening the order's own DB
   * transaction, so the (heavier, DB-independent) eligibility math doesn't
   * hold a transaction open. Every check here is re-verified fresh inside
   * `recordRedemption` once the transaction actually opens — see that
   * method's own comment for why that isn't redundant.
   *
   * Scoped to order (TAKEOUT/DELIVERY) checkout only this phase —
   * RESERVATION_DISCOUNT/CATERING_DISCOUNT are creatable/targetable
   * discount types but have no redemption call site yet; see
   * architecture.md § 17 for why that's an honest scope line, not an
   * oversight.
   */
  static async validateAndPreviewDiscount(
    organizationId: string,
    promoCode: string,
    ctx: RedemptionOrderContext,
  ): Promise<DiscountPreview> {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } });
    const promotion = await prisma.promotion.findFirst({
      where: { organizationId, promoCode: promoCode.trim().toUpperCase() },
    });
    if (!promotion) throw new NotFoundError('Promotion code');

    await this.assertEligible(organizationId, promotion, ctx, org.timezone);
    const { discountAmount, waiveDeliveryFee } = await this.computeDiscount(promotion, ctx);
    return { promotion, discountAmount, waiveDeliveryFee };
  }

  private static async assertEligible(
    organizationId: string,
    promotion: Promotion,
    ctx: RedemptionOrderContext,
    timezone: string,
  ): Promise<void> {
    const now = new Date();
    const effective = deriveEffectiveStatus(promotion, now);
    if (effective !== 'ACTIVE') throw new ConflictError('This promotion is not currently active.');
    if (!withinTimeOfDayWindow(promotion, timezone, now)) {
      throw new ConflictError(`This promotion is only valid between ${promotion.startTimeOfDay} and ${promotion.endTimeOfDay}.`);
    }

    const eligibleServices = Array.isArray(promotion.eligibleServices) ? (promotion.eligibleServices as string[]) : [];
    if (eligibleServices.length > 0 && !eligibleServices.includes(ctx.orderType)) {
      throw new ConflictError(`This promotion is not valid for ${ctx.orderType.toLowerCase()} orders.`);
    }
    if (promotion.minimumOrderValue && ctx.subtotal.lessThan(new Prisma.Decimal(promotion.minimumOrderValue as never))) {
      throw new ConflictError(`This promotion requires a minimum order of ${promotion.minimumOrderValue}.`);
    }
    if (promotion.eligibleMenuItemIds.length > 0 && !ctx.items.some((i) => promotion.eligibleMenuItemIds.includes(i.menuItemId))) {
      throw new ConflictError('None of the items in your cart are eligible for this promotion.');
    }
    if (promotion.eligibleCategoryIds.length > 0 && !ctx.items.some((i) => promotion.eligibleCategoryIds.includes(i.categoryId))) {
      throw new ConflictError('None of the items in your cart are eligible for this promotion.');
    }
    if (promotion.usageLimit != null && promotion.redemptionCount >= promotion.usageLimit) {
      throw new ConflictError('This promotion has reached its usage limit.');
    }

    const priorRedemptions = await prisma.promotionRedemption.count({ where: { promotionId: promotion.id, customerId: ctx.customerId } });
    if (promotion.customerUsageLimit != null && priorRedemptions >= promotion.customerUsageLimit) {
      throw new ConflictError('You have already used this promotion the maximum number of times.');
    }

    await this.assertTypeSpecificEligibility(organizationId, promotion, ctx);
  }

  private static async assertTypeSpecificEligibility(organizationId: string, promotion: Promotion, ctx: RedemptionOrderContext): Promise<void> {
    switch (promotion.discountType) {
      case 'CATERING_DISCOUNT':
      case 'RESERVATION_DISCOUNT':
        throw new ConflictError('This promotion is redeemed through catering/reservations, not order checkout.');
      case 'LOYALTY_REWARD': {
        // CAPP Phase 10 — real as of this phase. `loyaltyPointsCost` is
        // required for this discount type at the Zod layer
        // (lib/validation/promotion.ts), but a defensive check here too —
        // a promotion created before that validation existed, or edited
        // directly, shouldn't silently redeem for free.
        if (!promotion.loyaltyPointsCost || promotion.loyaltyPointsCost <= 0) {
          throw new ConflictError('This loyalty reward has no points cost configured.');
        }
        const customer = await prisma.customer.findUniqueOrThrow({ where: { id: ctx.customerId }, select: { customerAccountId: true } });
        if (!customer.customerAccountId) throw new ConflictError('This reward requires a signed-in app account.');
        const account = await LoyaltyService.getOrCreateAccount(prisma, organizationId, customer.customerAccountId);
        if (account.pointsBalance < promotion.loyaltyPointsCost) {
          throw new ConflictError(`This reward requires ${promotion.loyaltyPointsCost} points — you have ${account.pointsBalance}.`);
        }
        return;
      }
      case 'FIRST_ORDER': {
        const priorOrders = await prisma.order.count({
          where: { organizationId, customerId: ctx.customerId, status: { not: 'CANCELLED' } },
        });
        if (priorOrders > 0) throw new ConflictError('This promotion is only valid on your first order.');
        return;
      }
      case 'REPEAT_CUSTOMER': {
        const priorOrders = await prisma.order.count({
          where: { organizationId, customerId: ctx.customerId, status: { not: 'CANCELLED' } },
        });
        if (priorOrders === 0) throw new ConflictError('This promotion requires at least one prior order.');
        return;
      }
      case 'BIRTHDAY': {
        const customer = await prisma.customer.findUniqueOrThrow({ where: { id: ctx.customerId }, select: { customerAccountId: true } });
        const account = customer.customerAccountId
          ? await prisma.customerAccount.findUnique({ where: { id: customer.customerAccountId }, select: { dateOfBirth: true } })
          : null;
        if (!account?.dateOfBirth || !this.isNearBirthday(account.dateOfBirth, new Date())) {
          throw new ConflictError('This promotion is only valid near your birthday.');
        }
        return;
      }
      case 'CUSTOMER_SPECIFIC': {
        const customer = await prisma.customer.findUniqueOrThrow({ where: { id: ctx.customerId }, select: { customerAccountId: true } });
        const claim = customer.customerAccountId
          ? await prisma.customerPromotion.findUnique({ where: { customerAccountId_promotionId: { customerAccountId: customer.customerAccountId, promotionId: promotion.id } } })
          : null;
        if (!claim || claim.status === 'EXPIRED') {
          throw new ConflictError('This promotion was not offered to you.');
        }
        return;
      }
      default:
        return;
    }
  }

  /** Within 3 days either side of the customer's birthday (month+day, year-independent) — a small grace window, not an exact-day-only gate. */
  private static isNearBirthday(dateOfBirth: Date, now: Date): boolean {
    const birthdayThisYear = new Date(now.getFullYear(), dateOfBirth.getMonth(), dateOfBirth.getDate());
    const diffDays = Math.abs((now.getTime() - birthdayThisYear.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 3;
  }

  /**
   * Discount-type -> peso amount. See schema.prisma's PromotionDiscountType
   * comment for which types compute a real amount vs. are rejected above in
   * `assertTypeSpecificEligibility` before ever reaching here.
   *
   * FIRST_ORDER/REPEAT_CUSTOMER/BIRTHDAY/CUSTOMER_SPECIFIC/LOYALTY_REWARD are
   * eligibility *gates* layered on top of a flat discount — `discountValue`
   * for these five is read as a peso amount (like FIXED_AMOUNT), not a rate,
   * since the spec names them as distinct discount types without separately
   * specifying their own rate-vs-amount shape; a flat amount is the
   * simplest, least ambiguous reading and is documented here rather than
   * silently assumed.
   */
  private static async computeDiscount(
    promotion: Promotion,
    ctx: RedemptionOrderContext,
  ): Promise<{ discountAmount: Prisma.Decimal; waiveDeliveryFee: boolean }> {
    const value = new Prisma.Decimal(promotion.discountValue as never);
    let raw: Prisma.Decimal;
    let waiveDeliveryFee = false;

    switch (promotion.discountType) {
      case 'PERCENTAGE':
        raw = ctx.subtotal.times(value).dividedBy(100);
        break;
      case 'FREE_DELIVERY':
        raw = ctx.deliveryFee;
        waiveDeliveryFee = true;
        break;
      case 'BOGO':
      case 'FREE_ITEM': {
        // The cheapest eligible line's unit price — see
        // schema.prisma's PromotionDiscountType comment for why this
        // interpretation, not a full free-item-selection feature.
        const eligible = this.eligibleItems(promotion, ctx.items);
        if (eligible.length === 0) throw new ConflictError('None of the items in your cart are eligible for this promotion.');
        raw = eligible.reduce((min, i) => (i.lineTotal.lessThan(min) ? i.lineTotal : min), eligible[0]!.lineTotal);
        break;
      }
      case 'FIXED_AMOUNT':
      case 'BUNDLE':
      case 'FREE_ADDON':
      case 'FIRST_ORDER':
      case 'REPEAT_CUSTOMER':
      case 'BIRTHDAY':
      case 'CUSTOMER_SPECIFIC':
      // CAPP Phase 10 — same flat-`discountValue`-in-pesos reading as the
      // seven types above; the points side of the exchange
      // (`loyaltyPointsCost`) is enforced separately in
      // `assertTypeSpecificEligibility` and actually deducted in
      // `recordRedemption` via `LoyaltyService.redeemPoints`.
      case 'LOYALTY_REWARD':
        raw = value;
        break;
      default:
        // CATERING_DISCOUNT/RESERVATION_DISCOUNT already threw in
        // assertTypeSpecificEligibility — unreachable here, but
        // exhaustiveness keeps this switch honest if a new type is added.
        throw new ConflictError(`Discount type ${promotion.discountType} is not redeemable through order checkout.`);
    }

    let capped = raw;
    if (promotion.maximumDiscount) {
      const cap = new Prisma.Decimal(promotion.maximumDiscount as never);
      if (capped.greaterThan(cap)) capped = cap;
    }
    if (!waiveDeliveryFee && capped.greaterThan(ctx.subtotal)) capped = ctx.subtotal;
    return { discountAmount: capped, waiveDeliveryFee };
  }

  private static eligibleItems(promotion: Pick<Promotion, 'eligibleMenuItemIds' | 'eligibleCategoryIds'>, items: RedemptionOrderContext['items']) {
    const noRestriction = promotion.eligibleMenuItemIds.length === 0 && promotion.eligibleCategoryIds.length === 0;
    if (noRestriction) return items;
    return items.filter((i) => promotion.eligibleMenuItemIds.includes(i.menuItemId) || promotion.eligibleCategoryIds.includes(i.categoryId));
  }

  // --- redemption: record (inside the order's own transaction) ------------

  /**
   * The atomic, race-safe half of redemption — must run inside the SAME
   * `prisma.$transaction` as the order it discounts (`OrderService.
   * createOrder` calls this after creating the order row, passing its own
   * `tx`), so a crash between "order created" and "redemption recorded" can
   * never leave one without the other.
   *
   * Re-validates status/usage limits fresh (the promotion could have
   * changed between `validateAndPreviewDiscount`'s pre-transaction read and
   * this transaction actually committing — e.g. staff paused it, or a
   * concurrent order just used the last slot) rather than trusting the
   * earlier preview. The overall usage-limit check uses Prisma's atomic
   * `increment` (`SET redemptionCount = redemptionCount + 1`, the same
   * "read-current-value-is-racy, atomic-increment-isn't" idiom
   * `InventoryService.applyTransaction` already established) and throws if
   * the post-increment count exceeds the limit — the throw rolls back the
   * whole transaction, including the increment itself, so a lost race never
   * leaves `redemptionCount` overcounted. Because that increment takes a
   * row-level lock on the `Promotion` row for the rest of this transaction,
   * every other check in this method (including the per-customer count,
   * which two concurrent requests from the very same customer could
   * otherwise race) is serialized behind it too — see architecture.md § 17
   * for the full reasoning.
   */
  static async recordRedemption(
    tx: Tx,
    args: { organizationId: string; promotion: Promotion; customerId: string; orderId: string; discountAmount: Prisma.Decimal },
  ): Promise<void> {
    const { organizationId, promotion, customerId, orderId, discountAmount } = args;

    const fresh = await tx.promotion.findUniqueOrThrow({ where: { id: promotion.id } });
    if (deriveEffectiveStatus(fresh, new Date()) !== 'ACTIVE') {
      throw new ConflictError('This promotion is no longer active.');
    }

    const incremented = await tx.promotion.update({ where: { id: promotion.id }, data: { redemptionCount: { increment: 1 } } });
    if (fresh.usageLimit != null && incremented.redemptionCount > fresh.usageLimit) {
      throw new ConflictError('This promotion has reached its usage limit.');
    }

    const priorRedemptions = await tx.promotionRedemption.count({ where: { promotionId: promotion.id, customerId } });
    if (fresh.customerUsageLimit != null && priorRedemptions >= fresh.customerUsageLimit) {
      throw new ConflictError('You have already used this promotion the maximum number of times.');
    }

    await tx.promotionRedemption.create({
      data: { organizationId, promotionId: promotion.id, customerId, orderId, discountAmount: discountAmount.toFixed(2) },
    });

    // Advance the customer's own claim record if one exists — see
    // CustomerPromotion's schema.prisma comment for why REDEEMED cycles
    // back to CLAIMED (not AVAILABLE) when more uses remain.
    const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { customerAccountId: true } });
    if (customer?.customerAccountId) {
      const claim = await tx.customerPromotion.findUnique({
        where: { customerAccountId_promotionId: { customerAccountId: customer.customerAccountId, promotionId: promotion.id } },
      });
      const timesRedeemed = (claim?.timesRedeemed ?? 0) + 1;
      const remaining = fresh.customerUsageLimit == null || timesRedeemed < fresh.customerUsageLimit;
      await tx.customerPromotion.upsert({
        where: { customerAccountId_promotionId: { customerAccountId: customer.customerAccountId, promotionId: promotion.id } },
        create: {
          customerAccountId: customer.customerAccountId, organizationId, promotionId: promotion.id,
          status: remaining ? 'CLAIMED' : 'REDEEMED', claimedAt: new Date(), redeemedAt: new Date(), timesRedeemed,
        },
        update: { status: remaining ? 'CLAIMED' : 'REDEEMED', redeemedAt: new Date(), timesRedeemed },
      });

      // CAPP Phase 10 — the points side of a LOYALTY_REWARD redemption.
      // Deliberately re-checked/deducted here (inside this same
      // transaction), not trusted from `assertTypeSpecificEligibility`'s
      // earlier pre-transaction read — same "re-validate fresh inside the
      // transaction" discipline this method's own header comment describes
      // for the promotion's status/usage limits.
      if (fresh.discountType === 'LOYALTY_REWARD' && fresh.loyaltyPointsCost) {
        await LoyaltyService.redeemPoints(
          tx,
          organizationId,
          customer.customerAccountId,
          fresh.loyaltyPointsCost,
          orderId,
          `Redeemed for promotion "${fresh.title}"`,
        );
      }
    } else if (fresh.discountType === 'LOYALTY_REWARD') {
      // Unreachable through the normal checkout flow —
      // `assertTypeSpecificEligibility` already requires a signed-in app
      // account for this discount type — but a defensive throw here beats
      // silently letting a LOYALTY_REWARD redemption skip the points
      // deduction entirely if that guard is ever bypassed.
      throw new ConflictError('This reward requires a signed-in app account.');
    }
  }

  // --- helpers ---------------------------------------------------------------

  private static async assertCodeAvailable(organizationId: string, promoCode: string): Promise<void> {
    const conflict = await prisma.promotion.findFirst({
      where: { organizationId, promoCode, status: { notIn: ['ENDED', 'CANCELLED'] } },
    });
    if (conflict) throw new ConflictError(`Promo code "${promoCode}" is already in use by another active/scheduled promotion.`);
  }

  private static parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ConflictError(`${field} is not a valid date.`);
    return date;
  }
}
