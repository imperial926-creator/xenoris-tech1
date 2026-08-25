import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { SubscriptionAnalyticsService } from '@/services/platform-billing/SubscriptionAnalyticsService';
import { MrrMovementService } from './MrrMovementService';
import { RestaurantLifecycleService } from './RestaurantLifecycleService';
import { ComplaintService } from './ComplaintService';
import { ActionCenterService } from '@/services/platform-billing/ActionCenterService';
import { PlatformHealthService } from './PlatformHealthService';

/**
 * The SaaS PLATFORM's own admin-facing analytics & business intelligence —
 * see the Phase 18 header comment in schema.prisma for how this differs
 * from `services/analytics/AnalyticsService` (a restaurant owner's own
 * dashboard, org-scoped).
 *
 * ==========================================================================
 * VERY IMPORTANT — restaurant gross sales vs. SaaS subscription revenue
 * ==========================================================================
 * The master spec states this twice, marked "VERY IMPORTANT": restaurant
 * gross sales (what diners paid restaurants for food) and SaaS subscription
 * revenue (what restaurants pay THIS PLATFORM to use the software) must
 * never be combined into one figure. This service enforces that by
 * construction: `restaurantGrossSales()` and `revenueAnalytics()`
 * (SaaS revenue) are separate methods, returning separately-labeled
 * figures, and NO method in this file sums them together. `platformOverview`
 * returns both under distinct top-level keys (`saasRevenue`,
 * `restaurantGrossSales`) specifically so a UI consuming this object cannot
 * accidentally add them without deliberately reaching into both.
 */
export class PlatformAnalyticsService {
  /** SaaS subscription revenue — what restaurants pay THIS platform. Never combine with restaurantGrossSales(). */
  static async revenueAnalytics(range: { startDate: Date; endDate: Date }) {
    const [subscriptionAnalytics, paymentAnalytics, movement] = await Promise.all([
      SubscriptionAnalyticsService.subscriptionAnalytics(),
      SubscriptionAnalyticsService.paymentAnalytics(range),
      MrrMovementService.movementReport(range),
    ]);
    return {
      mrr: subscriptionAnalytics.mrr,
      arr: subscriptionAnalytics.arr,
      averageRevenuePerRestaurant: subscriptionAnalytics.averageRevenuePerRestaurant,
      grossRevenueThisPeriod: paymentAnalytics.grossRevenue,
      netRevenueThisPeriod: paymentAnalytics.netRevenue,
      mrrMovement: movement,
      currency: 'PHP',
    };
  }

  /**
   * Restaurant transaction value — what DINERS paid RESTAURANTS, summed
   * across every organization on the platform. This is operational volume
   * the platform processes, NOT platform revenue. Never combine with
   * revenueAnalytics()'s SaaS figures.
   */
  static async restaurantGrossSales(range: { startDate: Date; endDate: Date }) {
    const result = await prisma.order.aggregate({
      where: { createdAt: { gte: range.startDate, lte: range.endDate }, status: { notIn: ['CANCELLED'] } },
      _sum: { total: true },
      _count: { _all: true },
      _avg: { total: true },
    });
    return {
      totalRestaurantGrossSales: result._sum.total?.toFixed(2) ?? '0.00',
      totalOrders: result._count._all,
      averageOrderValue: result._avg.total?.toFixed(2) ?? '0.00',
      currency: 'PHP',
      label: 'RESTAURANT TRANSACTION VALUE (not SaaS revenue — see this file header)',
    };
  }

  /** Master spec's Executive Overview — the single top-level admin dashboard. */
  static async executiveOverview(range: { startDate: Date; endDate: Date }) {
    const [revenue, grossSales, subs, restaurantCounts, complaints, actionCounts, health, funnel] = await Promise.all([
      this.revenueAnalytics(range),
      this.restaurantGrossSales(range),
      SubscriptionAnalyticsService.subscriptionAnalytics(),
      prisma.organization.count(),
      ComplaintService.complaintAnalytics(range),
      ActionCenterService.dashboardCounts(),
      PlatformHealthService.summary(range),
      RestaurantLifecycleService.funnelSnapshot(),
    ]);

    return {
      saasRevenue: revenue,
      restaurantGrossSales: grossSales,
      subscriptions: subs,
      totalRestaurants: restaurantCounts,
      complaints,
      actionCenter: actionCounts,
      platformHealth: health,
      lifecycleFunnel: funnel,
    };
  }

  /** Master spec's Plan Popularity report. */
  static async planPopularity() {
    const rows = await prisma.subscription.groupBy({
      by: ['planId'],
      where: { status: { in: ['ACTIVE', 'PAST_DUE'] } },
      _count: { _all: true },
    });
    const plans = await prisma.subscriptionPlan.findMany({
      where: { id: { in: rows.map((r) => r.planId) } },
    });
    const planById = new Map(plans.map((p) => [p.id, p]));
    return rows
      .map((r) => ({
        planId: r.planId,
        planName: planById.get(r.planId)?.name ?? 'Unknown',
        subscriberCount: r._count._all,
      }))
      .sort((a, b) => b.subscriberCount - a.subscriberCount);
  }

  /**
   * Master spec's Restaurant Performance Ranking — explicitly framed for
   * "success analysis / case studies / customer support / product
   * improvement", NOT to punish restaurants (spec's own instruction).
   * Ranks by MRR contribution to the platform, which is the one figure
   * this service can compute without conflating it with restaurant gross
   * sales.
   */
  static async topRestaurantsByMrr(limit = 20) {
    const activeSubs = await prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
      include: { plan: true, organization: { select: { id: true, name: true } } },
    });
    return activeSubs
      .map((sub) => ({
        organizationId: sub.organizationId,
        organizationName: sub.organization.name,
        planName: sub.plan.name,
        monthlyValue: (Number(sub.plan.monthlyPrice) / Math.max(1, sub.billingIntervalMonths)).toFixed(2),
      }))
      .sort((a, b) => Number(b.monthlyValue) - Number(a.monthlyValue))
      .slice(0, limit);
  }

  /**
   * App popularity / usage — DAU/WAU/MAU of the CAPP customer mobile app,
   * platform-wide, from `CustomerAnalyticsEvent.APP_OPENED` (CAPP Phase
   * 11's existing, privacy-conscious event log — no IP/device/location).
   * This is the CUSTOMER-facing app's usage, not the restaurant owner
   * admin dashboard's — the spec's "Application Popularity" section is
   * about the diner-facing app restaurants' customers install.
   */
  static async appUsageAnalytics(now: Date) {
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

    const [dau, wau, mau, totalSessions] = await Promise.all([
      prisma.customerAnalyticsEvent
        .findMany({ where: { eventType: 'APP_OPENED', createdAt: { gte: dayAgo } }, select: { customerAccountId: true }, distinct: ['customerAccountId'] })
        .then((r) => r.length),
      prisma.customerAnalyticsEvent
        .findMany({ where: { eventType: 'APP_OPENED', createdAt: { gte: weekAgo } }, select: { customerAccountId: true }, distinct: ['customerAccountId'] })
        .then((r) => r.length),
      prisma.customerAnalyticsEvent
        .findMany({ where: { eventType: 'APP_OPENED', createdAt: { gte: monthAgo } }, select: { customerAccountId: true }, distinct: ['customerAccountId'] })
        .then((r) => r.length),
      prisma.customerAnalyticsEvent.count({ where: { eventType: 'APP_OPENED', createdAt: { gte: monthAgo } } }),
    ]);

    return { dau, wau, mau, totalSessionsLast30Days: totalSessions };
  }

  /**
   * Master spec's Feature Usage / Popularity ranking — real counts across
   * a subset of the platform's named features (the ones with a countable,
   * platform-wide-groupable table). Not every one of the spec's ~20 named
   * features has a distinct countable table (some are UI-only toggles), so
   * this covers the ones that do rather than fabricating counts for the
   * rest.
   */
  static async featureUsageRanking(range: { startDate: Date; endDate: Date }) {
    const where = { createdAt: { gte: range.startDate, lte: range.endDate } };
    const [promotions, loyaltyRedemptions, catering, delivery, reservations, inventory] = await Promise.all([
      prisma.promotionRedemption.count({ where: { redeemedAt: { gte: range.startDate, lte: range.endDate } } }),
      prisma.loyaltyAccount.count(),
      prisma.cateringInquiry.count({ where }),
      prisma.deliveryOrder.count({ where }),
      prisma.reservation.count({ where }),
      prisma.inventoryTransaction.count({ where }),
    ]);

    return [
      { feature: 'Promotions', usageCount: promotions },
      { feature: 'Loyalty', usageCount: loyaltyRedemptions },
      { feature: 'Catering', usageCount: catering },
      { feature: 'Delivery', usageCount: delivery },
      { feature: 'Reservations', usageCount: reservations },
      { feature: 'Inventory', usageCount: inventory },
    ].sort((a, b) => b.usageCount - a.usageCount);
  }

  /**
   * Aggregated-only customer analytics — master spec's explicit "Do NOT
   * expose personal information unnecessarily" rule. Returns platform-wide
   * counts, never a per-customer breakdown.
   */
  static async customerAnalytics(range: { startDate: Date; endDate: Date }) {
    const where = { createdAt: { gte: range.startDate, lte: range.endDate } };
    const [totalCustomersAllTime, newCustomers, totalDiningOrders] = await Promise.all([
      prisma.customer.count(),
      prisma.customer.count({ where }),
      prisma.order.count({ where }),
    ]);
    return { totalCustomersAllTime, newCustomers, totalDiningOrders };
  }
}
