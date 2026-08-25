import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError } from '@/lib/utils/api-error';
import type { ReportDateRangeQueryInput } from '@/lib/validation/reporting';
import { ReportingService } from '@/services/reporting/ReportingService';

/**
 * CAPP Phase 11 — spec § 29 "Promotion Analytics," § 30 "Promotion ROI,"
 * § 55 "Campaign Analytics," § 56 "Financial Integration," § 57 "Analytics"
 * (the "Customer engagement"/"Sales attribution" items from the phased plan
 * § 62). Every number here is computed from rows already written by prior
 * CAPP phases plus the one new table this phase adds
 * (`CustomerAnalyticsEvent`) — nothing is estimated or fabricated, per the
 * master spec's own "Do not fake promotional analytics" instruction.
 *
 * **Table-by-funnel-step map** (spec § 29/§ 57's full event list, and where
 * each one actually comes from):
 * - Sent/Delivered/Opened  → `CustomerNotification`/`NotificationDelivery`
 *   (Phase 9). Delivered is real for IN_APP (always written `DELIVERED` at
 *   send time) but structurally can never reach `DELIVERED` for PUSH/EMAIL/
 *   SMS in this build — no provider webhook exists to confirm it (see
 *   architecture.md § 18). Opened is real for IN_APP only, wired this phase
 *   (see `CustomerNotificationService.markRead`) — a diner actually tapping
 *   into their notification center.
 * - Viewed/Clicked         → `CustomerAnalyticsEvent` (this phase, new —
 *   nothing else records a diner viewing or tapping a promotion).
 * - Claimed/Redeemed       → `CustomerPromotion`/`PromotionRedemption`
 *   (Phase 8). See the note on `CustomerPromotionStatus` below — the
 *   `CLAIMED` *status value* confusingly means "redeemed, more uses left,"
 *   not "claimed but unused"; "claimed" as a funnel step means "has a
 *   `CustomerPromotion` row at all," any status.
 * - Revenue/Discount amount/Orders generated → `PromotionRedemption` joined
 *   to `Order` (Phase 8). Revenue is COMPLETED-orders-only, matching how
 *   `AccountingService.recordOrderRevenue` itself only recognizes revenue on
 *   completion — discount cost counts every redemption regardless of the
 *   order's later status, since the discount (and, for a limited-use promo,
 *   the usage slot) was already given at redemption time.
 * - Reservations/Catering inquiries generated → **not trackable this
 *   build**: `PromotionRedemption` only has an `orderId` column (see its
 *   own schema.prisma comment — "a future reservation/catering redemption
 *   path would add its own nullable column"); `RESERVATION_DISCOUNT`/
 *   `CATERING_DISCOUNT` are creatable/targetable discount types with no
 *   redemption call site yet (Phase 8's own documented scope line). Always
 *   reported as `0`, listed in `dataGaps`, never guessed.
 * - Repeat purchases/Customer retention → computed from `Order` history
 *   after each redemption (see `countRepeatCustomers` below).
 * - App/Restaurant/Menu viewed, Reorder → `CustomerAnalyticsEvent`.
 * - Order/Reservation started/completed, Catering inquiry, Loyalty reward
 *   used → `Order`/`Reservation`/`CateringInquiry`/`LoyaltyTransaction`
 *   directly (Phases 1-10) — logging these again in the new event table
 *   would be exactly the duplicate system the master spec's own build
 *   instructions warn against.
 */
export class PromotionAnalyticsService {
  // --- campaign-level (spec § 55) ------------------------------------------

  static async getCampaignAnalytics(organizationId: string, campaignId: string) {
    const campaign = await prisma.promotionCampaign.findFirst({
      where: { id: campaignId, organizationId },
      select: { id: true, name: true, promotionId: true, status: true, sentAt: true, promotion: { select: { title: true } } },
    });
    if (!campaign) throw new NotFoundError('Campaign');

    const audience = await prisma.campaignAudience.findMany({ where: { campaignId }, select: { customerAccountId: true } });
    const audienceAccountIds = audience.map((a) => a.customerAccountId);
    const audienceSize = audienceAccountIds.length;

    const [notificationsSent, deliveredDistinct, openedDistinct, channelBreakdown] = await Promise.all([
      prisma.customerNotification.count({ where: { campaignId } }),
      prisma.notificationDelivery.findMany({
        where: { status: 'DELIVERED', customerNotification: { campaignId } },
        select: { customerNotificationId: true },
        distinct: ['customerNotificationId'],
      }),
      prisma.notificationDelivery.findMany({
        where: { openedAt: { not: null }, customerNotification: { campaignId } },
        select: { customerNotificationId: true },
        distinct: ['customerNotificationId'],
      }),
      prisma.notificationDelivery.groupBy({
        by: ['channel', 'status'],
        where: { customerNotification: { campaignId } },
        _count: { _all: true },
      }),
    ]);
    const delivered = deliveredDistinct.length;
    const opened = openedDistinct.length;

    const engagement = audienceSize > 0 ? await this.getPromotionEngagementForAccounts(organizationId, campaign.promotionId, audienceAccountIds) : null;

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      promotionId: campaign.promotionId,
      promotionTitle: campaign.promotion.title,
      status: campaign.status,
      sentAt: campaign.sentAt,
      audienceSize,
      notificationsSent,
      delivered,
      opened,
      channelBreakdown: channelBreakdown.map((c) => ({ channel: c.channel, status: c.status, count: c._count._all })),
      deliveryRate: rate(delivered, notificationsSent),
      openRate: rate(opened, delivered),
      claimed: engagement?.claimed ?? 0,
      redeemed: engagement?.redeemed ?? 0,
      claimRate: rate(engagement?.claimed ?? 0, audienceSize),
      redemptionRate: rate(engagement?.redeemed ?? 0, audienceSize),
      ordersGenerated: engagement?.ordersGenerated ?? 0,
      revenueGenerated: engagement?.revenueGenerated ?? '0.00',
      discountCost: engagement?.discountCost ?? '0.00',
      repeatCustomers: engagement?.repeatCustomers ?? 0,
      reservationConversions: 0,
      cateringConversions: 0,
      dataGaps: [
        'reservationConversions/cateringConversions: not tracked — PromotionRedemption has no reservationId/cateringInquiryId column, since only order-checkout redemption is wired (see architecture.md § 17).',
        'deliveryRate/openRate for PUSH/EMAIL/SMS: not measurable — no provider webhook confirms delivery or opens for those channels in this build (see architecture.md § 18); the figures above are dominated by the IN_APP channel, the only one this build can genuinely confirm.',
      ],
    };
  }

  // --- promotion-level (spec § 29-30) --------------------------------------

  static async getPromotionAnalytics(organizationId: string, promotionId: string) {
    const promotion = await prisma.promotion.findFirst({
      where: { id: promotionId, organizationId },
      select: { id: true, title: true, discountType: true, status: true },
    });
    if (!promotion) throw new NotFoundError('Promotion');

    const campaigns = await prisma.promotionCampaign.findMany({ where: { promotionId }, select: { id: true } });
    const campaignIds = campaigns.map((c) => c.id);

    const [audienceAccounts, claimedAccounts, notificationsSent, deliveredDistinct, openedDistinct, viewed, clicked, engagement] = await Promise.all([
      campaignIds.length
        ? prisma.campaignAudience.findMany({ where: { campaignId: { in: campaignIds } }, select: { customerAccountId: true }, distinct: ['customerAccountId'] })
        : Promise.resolve([]),
      prisma.customerPromotion.findMany({ where: { promotionId }, select: { customerAccountId: true } }),
      prisma.customerNotification.count({ where: { campaign: { promotionId } } }),
      prisma.notificationDelivery.findMany({
        where: { status: 'DELIVERED', customerNotification: { campaign: { promotionId } } },
        select: { customerNotificationId: true },
        distinct: ['customerNotificationId'],
      }),
      prisma.notificationDelivery.findMany({
        where: { openedAt: { not: null }, customerNotification: { campaign: { promotionId } } },
        select: { customerNotificationId: true },
        distinct: ['customerNotificationId'],
      }),
      prisma.customerAnalyticsEvent.count({ where: { organizationId, promotionId, eventType: 'PROMOTION_VIEWED' } }),
      prisma.customerAnalyticsEvent.count({ where: { organizationId, promotionId, eventType: 'PROMOTION_CLICKED' } }),
      this.getPromotionEngagementForAccounts(organizationId, promotionId, null),
    ]);

    const reachedSet = new Set<string>([...audienceAccounts.map((a) => a.customerAccountId), ...claimedAccounts.map((c) => c.customerAccountId)]);
    const customersReached = reachedSet.size;
    const claimed = claimedAccounts.length;
    const delivered = deliveredDistinct.length;
    const opened = openedDistinct.length;

    // Spec § 30's "Estimated/attributed ROI." This platform tracks no
    // separate marketing-spend/ad-cost figure — the only real cost a
    // promotion has here is the discount actually given away, so that's
    // what "Promotion Cost" means below. Documented equivalence, not a
    // narrower substitute silently standing in for a broader concept.
    const discountGivenNum = Number(engagement.discountCost);
    const revenueNum = Number(engagement.revenueGenerated);
    const estimatedRoi = discountGivenNum > 0 ? (revenueNum - discountGivenNum) / discountGivenNum : null;

    return {
      promotionId: promotion.id,
      promotionTitle: promotion.title,
      discountType: promotion.discountType,
      status: promotion.status,
      // spec § 30 — Promotion ROI dashboard
      promotionRevenue: engagement.revenueGenerated,
      promotionCost: engagement.discountCost,
      discountGiven: engagement.discountCost,
      ordersGenerated: engagement.ordersGenerated,
      customersReached,
      customersConverted: engagement.customersConverted,
      repeatOrders: engagement.repeatCustomers,
      estimatedRoi,
      // spec § 29 — Promotion Analytics funnel
      funnel: {
        sent: notificationsSent,
        delivered,
        opened,
        clicked,
        viewed,
        claimed,
        redeemed: engagement.redeemed,
        revenue: engagement.revenueGenerated,
        discountAmount: engagement.discountCost,
        ordersGenerated: engagement.ordersGenerated,
        reservationsGenerated: 0,
        cateringInquiriesGenerated: 0,
        repeatPurchases: engagement.repeatCustomers,
        customerRetention: rate(engagement.repeatCustomers, engagement.customersConverted),
      },
      dataGaps: [
        'reservationsGenerated/cateringInquiriesGenerated: not tracked — see PromotionRedemption schema note (order-checkout redemption only).',
        'estimatedRoi treats "Promotion Cost" as the discount given — no separate ad-spend/marketing-cost figure exists on this platform.',
      ],
    };
  }

  // --- org-wide (spec § 57 "Customer engagement" / § 56 "Sales attribution") --

  static async getCustomerEngagement(organizationId: string, query: ReportDateRangeQueryInput) {
    const { startDate, endDate } = await ReportingService.resolveReportDateRange(organizationId, query);
    const range = { gte: startDate, lte: endDate };

    const [
      appOpened, restaurantViewed, menuViewed, promotionViewed, promotionClicked, reorderTapped,
      promotionClaimed, promotionRedeemed,
      ordersStarted, ordersCompleted,
      reservationsStarted, reservationsCompleted,
      cateringInquiries,
      loyaltyRewardUsed,
    ] = await Promise.all([
      prisma.customerAnalyticsEvent.count({ where: { organizationId, eventType: 'APP_OPENED', createdAt: range } }),
      prisma.customerAnalyticsEvent.count({ where: { organizationId, eventType: 'RESTAURANT_VIEWED', createdAt: range } }),
      prisma.customerAnalyticsEvent.count({ where: { organizationId, eventType: 'MENU_VIEWED', createdAt: range } }),
      prisma.customerAnalyticsEvent.count({ where: { organizationId, eventType: 'PROMOTION_VIEWED', createdAt: range } }),
      prisma.customerAnalyticsEvent.count({ where: { organizationId, eventType: 'PROMOTION_CLICKED', createdAt: range } }),
      prisma.customerAnalyticsEvent.count({ where: { organizationId, eventType: 'REORDER_TAPPED', createdAt: range } }),
      prisma.customerPromotion.count({ where: { organizationId, claimedAt: range } }),
      prisma.promotionRedemption.count({ where: { organizationId, redeemedAt: range } }),
      prisma.order.count({ where: { organizationId, createdAt: range } }),
      prisma.order.count({ where: { organizationId, status: 'COMPLETED', createdAt: range } }),
      prisma.reservation.count({ where: { organizationId, createdAt: range } }),
      prisma.reservation.count({ where: { organizationId, status: 'COMPLETED', createdAt: range } }),
      prisma.cateringInquiry.count({ where: { organizationId, createdAt: range } }),
      prisma.loyaltyTransaction.count({ where: { type: 'REDEEM', createdAt: range, loyaltyAccount: { organizationId } } }),
    ]);

    return {
      dateRange: { startDate, endDate, preset: query.preset },
      appOpened,
      restaurantViewed,
      menuViewed,
      promotionViewed,
      promotionClicked,
      promotionClaimed,
      promotionRedeemed,
      ordersStarted,
      ordersCompleted,
      reservationsStarted,
      reservationsCompleted,
      cateringInquiries,
      reorderTapped,
      loyaltyRewardUsed,
      dataGaps: [
        'ordersStarted/reservationsStarted count rows created in this range (any status), not a distinct "began checking out" moment — carts and reservation searches aren\'t persisted server-side until submitted, so there is no earlier "started" event to capture without new client-side tracking this phase doesn\'t add.',
        'ordersCompleted/reservationsCompleted are filtered on createdAt, not a dedicated completion timestamp — neither Order nor Reservation stores one, so a request created near a range boundary but completed after it (or vice versa) can be slightly misattributed.',
      ],
    };
  }

  static async getSalesAttribution(organizationId: string, query: ReportDateRangeQueryInput) {
    const { startDate, endDate } = await ReportingService.resolveReportDateRange(organizationId, query);
    const range = { gte: startDate, lte: endDate };
    const baseWhere = { organizationId, status: 'COMPLETED' as const, createdAt: range };

    const [totals, promotionAttributed] = await Promise.all([
      prisma.order.aggregate({ where: baseWhere, _sum: { subtotal: true, discountTotal: true, deliveryFee: true, total: true } }),
      prisma.order.aggregate({ where: { ...baseWhere, promotionRedemption: { isNot: null } }, _sum: { subtotal: true, discountTotal: true, deliveryFee: true, total: true }, _count: true }),
    ]);

    // Same revenue-recognition formula AccountingService.recordOrderRevenue
    // already uses when an order completes — reused here rather than
    // inventing a second definition of "net sales" for this one report.
    const grossSales = decimalSum(totals._sum.subtotal, totals._sum.deliveryFee);
    const discounts = num(totals._sum.discountTotal);
    const netSales = grossSales - discounts;
    const promotionAttributedGross = decimalSum(promotionAttributed._sum.subtotal, promotionAttributed._sum.deliveryFee);
    const promotionAttributedDiscounts = num(promotionAttributed._sum.discountTotal);
    const promotionAttributedSales = promotionAttributedGross - promotionAttributedDiscounts;

    return {
      dateRange: { startDate, endDate, preset: query.preset },
      grossSales: grossSales.toFixed(2),
      discounts: discounts.toFixed(2),
      netSales: netSales.toFixed(2),
      promotionAttributedSales: promotionAttributedSales.toFixed(2),
      promotionAttributedOrders: promotionAttributed._count,
      promotionAttributedShare: rate(promotionAttributedSales, netSales),
      refunds: null,
      paymentFeesAvailable: null,
      dataGaps: [
        'refunds: not tracked at the order level — this build has no order-refund workflow (only reservation-deposit and catering-event refunds exist, and neither is promotion-attributable, so both are out of scope for this report).',
        'paymentFeesAvailable: not tracked — no payment gateway is integrated (see the master spec\'s own "Do not fake payments" instruction and OrderPaymentMethod\'s own comments); this platform only records which payment method was declared, never a processor or its fees.',
      ],
    };
  }

  // --- shared helpers -------------------------------------------------------

  /**
   * Redemption-driven numbers shared by both the campaign- and
   * promotion-level reports above, optionally scoped to one campaign's
   * audience (`accountIds`) or left `null` for the whole promotion.
   * `claimed`/`redeemed` read `CustomerPromotion` (see this class's own
   * header for why `status: 'CLAIMED'` really means "redeemed, more uses
   * left" — both `CLAIMED` and `REDEEMED` count as "has redeemed at least
   * once"); everything else reads `PromotionRedemption` joined to `Order`.
   */
  private static async getPromotionEngagementForAccounts(organizationId: string, promotionId: string, accountIds: string[] | null) {
    const customerPromotionWhere = accountIds
      ? { promotionId, customerAccountId: { in: accountIds } }
      : { promotionId };
    const [claimed, redeemed, redemptions] = await Promise.all([
      prisma.customerPromotion.count({ where: customerPromotionWhere }),
      prisma.customerPromotion.count({ where: { ...customerPromotionWhere, status: { in: ['CLAIMED', 'REDEEMED'] } } }),
      prisma.promotionRedemption.findMany({
        where: {
          promotionId,
          ...(accountIds ? { customer: { customerAccountId: { in: accountIds } } } : {}),
        },
        select: {
          orderId: true,
          customerId: true,
          discountAmount: true,
          order: { select: { id: true, total: true, status: true, createdAt: true, customerId: true } },
        },
      }),
    ]);

    const ordersGenerated = redemptions.filter((r) => r.orderId != null).length;
    const discountCost = decimalSumOf(redemptions.map((r) => r.discountAmount));
    const revenueGenerated = decimalSumOf(
      redemptions.filter((r) => r.order?.status === 'COMPLETED').map((r) => r.order!.total),
    );
    const customersConverted = new Set(redemptions.map((r) => r.customerId)).size;
    const repeatCustomers = await this.countRepeatCustomers(organizationId, redemptions);

    return {
      claimed,
      redeemed,
      ordersGenerated,
      discountCost: discountCost.toFixed(2),
      revenueGenerated: revenueGenerated.toFixed(2),
      customersConverted,
      repeatCustomers,
    };
  }

  /**
   * Spec § 29/§ 30 "Repeat purchases"/"Repeat Orders": among customers who
   * redeemed this promotion, how many placed at least one further
   * non-cancelled order afterward. One extra query for the whole set (not
   * one per customer) — fetches every later order for the redeeming
   * customers and checks in memory, same "N+1 avoided, one query per
   * caller" shape as `AudienceResolver`'s own segment queries.
   */
  private static async countRepeatCustomers(
    organizationId: string,
    redemptions: Array<{ order: { customerId: string | null; createdAt: Date } | null }>,
  ): Promise<number> {
    const firstRedeemedAt = new Map<string, Date>();
    for (const r of redemptions) {
      if (!r.order?.customerId) continue;
      const existing = firstRedeemedAt.get(r.order.customerId);
      if (!existing || r.order.createdAt < existing) firstRedeemedAt.set(r.order.customerId, r.order.createdAt);
    }
    if (firstRedeemedAt.size === 0) return 0;

    const laterOrders = await prisma.order.findMany({
      where: { organizationId, customerId: { in: [...firstRedeemedAt.keys()] }, status: { not: 'CANCELLED' } },
      select: { customerId: true, createdAt: true },
    });

    let repeatCount = 0;
    for (const [customerId, firstAt] of firstRedeemedAt) {
      const hasLater = laterOrders.some((o) => o.customerId === customerId && o.createdAt > firstAt);
      if (hasLater) repeatCount++;
    }
    return repeatCount;
  }
}

function rate(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

function num(value: unknown): number {
  return value == null ? 0 : Number(value);
}

function decimalSum(...values: unknown[]): number {
  return values.reduce((sum: number, v) => sum + num(v), 0);
}

function decimalSumOf(values: unknown[]): number {
  return values.reduce((sum: number, v) => sum + num(v), 0);
}
