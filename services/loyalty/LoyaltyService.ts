import 'server-only';
import { Prisma } from '@prisma/client';
import type { LoyaltyAccount, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';
import { emitRealtimeEvent } from '@/lib/realtime/emit';
import { resolveLoyaltySettings, resolveTier } from '@/lib/loyalty/loyalty-settings';

type Tx = Prisma.TransactionClient;

/**
 * CAPP Phase 10 — spec § 37 "Customer loyalty." Two real write paths this
 * phase builds:
 *
 *   1. `earnPointsForOrder` — called from `OrderService.updateStatus`'s
 *      COMPLETED block, inside that same transaction (one business event,
 *      one transaction, matching every prior phase's Order-side-effect
 *      shape — Inventory consumption, Accounting postings, CAPP Phase 9
 *      notifications).
 *   2. `redeemPoints` — called from `PromotionService.recordRedemption`,
 *      inside that same order-creation transaction, only when the
 *      redeemed promotion's `discountType` is `LOYALTY_REWARD`.
 *
 * `LoyaltyTransactionType.EXPIRE`/`ADJUST` are real, valid enum states (see
 * schema.prisma's own comment) but have no writer yet — no points-expiry
 * job exists (same no-scheduler constraint `NotificationDispatchService`
 * documents) and no staff manual-adjustment surface was built this phase.
 * Flagged, not faked.
 */
export class LoyaltyService {
  /** Every account row this phase creates is lazy — a diner's first order/redemption at a restaurant is what actually opens their LoyaltyAccount there, not registration. */
  static async getOrCreateAccount(client: Tx | PrismaClient, organizationId: string, customerAccountId: string): Promise<LoyaltyAccount> {
    const existing = await client.loyaltyAccount.findUnique({
      where: { organizationId_customerAccountId: { organizationId, customerAccountId } },
    });
    if (existing) return existing;
    return client.loyaltyAccount.create({ data: { organizationId, customerAccountId } });
  }

  /**
   * Spec § 37 "Repeat-order rewards." `netAmount` is the order's subtotal
   * minus its discount — tax and delivery fee are excluded (rewarding
   * spend on food, not government tax or a courier's fee, matching how
   * `AccountingService.recordOrderRevenue` already separates those). A
   * guest order with no linked `CustomerAccount` earns nothing — there is
   * no account to credit. Best-effort in the sense that a zero/negative
   * result or a missing account is a normal no-op, not an error; a real DB
   * failure still propagates and rolls back the caller's transaction, same
   * as every other COMPLETED-block side effect.
   */
  static async earnPointsForOrder(
    tx: Tx,
    organizationId: string,
    customerAccountId: string | null | undefined,
    orderId: string,
    netAmount: Prisma.Decimal,
  ): Promise<void> {
    if (!customerAccountId) return;
    if (netAmount.lessThanOrEqualTo(0)) return;

    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { customerAppSettings: true } });
    const settings = resolveLoyaltySettings(org?.customerAppSettings ?? null);
    const points = Math.floor(netAmount.toNumber() / settings.currencyPerPoint);
    if (points <= 0) return;

    const account = await this.getOrCreateAccount(tx, organizationId, customerAccountId);
    const newLifetime = account.lifetimePoints + points;
    const newTier = resolveTier(newLifetime, settings.tiers);
    const tierChanged = newTier !== account.tier;

    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: { pointsBalance: { increment: points }, lifetimePoints: newLifetime, tier: newTier },
    });
    await tx.loyaltyTransaction.create({
      data: { loyaltyAccountId: account.id, type: 'EARN', points, relatedOrderId: orderId, description: `Earned from order` },
    });

    await emitRealtimeEvent(tx, {
      organizationId,
      type: 'LoyaltyPointsEarned',
      customerAccountId,
      payload: { loyaltyAccountId: account.id, points, orderId },
      notification: {
        category: 'LOYALTY',
        title: 'Points earned',
        message: `You earned ${points} point${points === 1 ? '' : 's'} from your order.`,
        deepLink: 'Profile',
        relatedEntityType: 'LoyaltyAccount',
        relatedEntityId: account.id,
      },
    });

    if (tierChanged) {
      await emitRealtimeEvent(tx, {
        organizationId,
        type: 'LoyaltyTierChanged',
        customerAccountId,
        payload: { loyaltyAccountId: account.id, tier: newTier, previousTier: account.tier },
        notification: {
          category: 'LOYALTY',
          title: `You've reached ${newTier} tier!`,
          message: `Congratulations — you're now a ${newTier.charAt(0)}${newTier.slice(1).toLowerCase()} member.`,
          deepLink: 'Profile',
          relatedEntityType: 'LoyaltyAccount',
          relatedEntityId: account.id,
        },
      });
    }
  }

  /**
   * Spec § 37's points-redemption half, called from
   * `PromotionService.recordRedemption` for a `LOYALTY_REWARD` promotion.
   * Race-safe the same way `NotificationDispatchService`'s sibling
   * atomic-decrement-with-floor-guard pattern works: `updateMany`'s WHERE
   * clause re-checks `pointsBalance >= points` at the moment the row lock
   * is actually taken, not against a value read earlier — two concurrent
   * redemption attempts against the same (already-low) balance can't both
   * succeed, the same "atomic op, not read-then-write" discipline
   * `PromotionService.recordRedemption`'s own `redemptionCount` increment
   * already established.
   */
  static async redeemPoints(
    tx: Tx,
    organizationId: string,
    customerAccountId: string,
    points: number,
    orderId: string | null,
    description: string,
  ): Promise<void> {
    if (points <= 0) throw new ConflictError('Loyalty point redemption amount must be positive.');
    const account = await this.getOrCreateAccount(tx, organizationId, customerAccountId);
    if (account.pointsBalance < points) throw new ConflictError('Not enough loyalty points for this reward.');

    const result = await tx.loyaltyAccount.updateMany({
      where: { id: account.id, pointsBalance: { gte: points } },
      data: { pointsBalance: { decrement: points } },
    });
    if (result.count === 0) throw new ConflictError('Not enough loyalty points for this reward.');

    await tx.loyaltyTransaction.create({
      data: { loyaltyAccountId: account.id, type: 'REDEEM', points: -points, relatedOrderId: orderId, description },
    });

    await emitRealtimeEvent(tx, {
      organizationId,
      type: 'LoyaltyRewardRedeemed',
      customerAccountId,
      payload: { loyaltyAccountId: account.id, points, orderId },
      notification: {
        category: 'LOYALTY',
        title: 'Loyalty reward redeemed',
        message: `You redeemed ${points} point${points === 1 ? '' : 's'} for a reward.`,
        deepLink: 'Profile',
        relatedEntityType: 'LoyaltyAccount',
        relatedEntityId: account.id,
      },
    });
  }

  /**
   * The diner's own loyalty summary (spec § 45 Home Screen "Loyalty
   * status") — points balance, tier, progress toward the next tier (null
   * once already at the top tier), and recent transaction history. Always
   * returns a summary, even before the diner has ever earned a point
   * (lazily creates the account the same way `getOrCreateAccount` does
   * everywhere else) — matches `CustomerNotificationService.getPreferences`'s
   * "always returns a row" convention.
   */
  static async getSummary(organizationId: string, customerAccountId: string) {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { customerAppSettings: true } });
    const settings = resolveLoyaltySettings(org.customerAppSettings);
    const account = await this.getOrCreateAccount(prisma, organizationId, customerAccountId);

    const currentIndex = settings.tiers.findIndex((t) => t.tier === account.tier);
    const nextTier = currentIndex >= 0 ? settings.tiers[currentIndex + 1] : undefined;

    const transactions = await prisma.loyaltyTransaction.findMany({
      where: { loyaltyAccountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    return {
      pointsBalance: account.pointsBalance,
      lifetimePoints: account.lifetimePoints,
      tier: account.tier,
      nextTier: nextTier
        ? { tier: nextTier.tier, pointsNeeded: Math.max(0, nextTier.minLifetimePoints - account.lifetimePoints) }
        : null,
      transactions,
    };
  }

  /**
   * Staff-facing read (spec § 37 gives restaurants a program to run — this
   * is how staff can actually see a customer's standing). Reuses
   * `getSummary` after resolving the CRM `Customer` -> `CustomerAccount`
   * link; a `Customer` with no linked account (walk-in, phone order) has no
   * loyalty program to show, same as this codebase's other "no app account,
   * nothing to display" boundaries (e.g. `AudienceResolver`'s
   * `candidatesWithAccount`).
   */
  static async getSummaryForCustomer(organizationId: string, customerId: string) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, organizationId }, select: { customerAccountId: true } });
    if (!customer) throw new NotFoundError('Customer');
    if (!customer.customerAccountId) throw new ConflictError('This customer has no linked app account — no loyalty program to show.');
    return this.getSummary(organizationId, customer.customerAccountId);
  }
}
