import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { ActionCenterService, TASK_TYPES } from '@/services/platform-billing/ActionCenterService';
import { PlatformAnalyticsConfigService } from './PlatformAnalyticsConfigService';

export type EngagementClassification = 'HEALTHY' | 'ENGAGED' | 'WATCH' | 'AT_RISK' | 'HIGH_RISK';

function classify(score: number): EngagementClassification {
  if (score >= 80) return 'HEALTHY';
  if (score >= 60) return 'ENGAGED';
  if (score >= 40) return 'WATCH';
  if (score >= 20) return 'AT_RISK';
  return 'HIGH_RISK';
}

// Each raw 30-day signal count is scaled to a 0-100 sub-score via
// `min(100, count * SCALE)` before weighting. These scale factors are a
// documented, tunable starting point (not derived from real platform-scale
// usage data, since this sandbox only ever has seed/demo data) — an
// operator should recalibrate them against real distributions once the
// platform has meaningful volume. They live here, not in
// `PlatformAnalyticsConfig`, because unlike the WEIGHTS (which trade off
// one signal against another, a genuine business judgment call the spec
// explicitly asks to be admin-configurable) these are a unit-conversion
// detail.
const SCALE = {
  loginsPerScore: 3, // 1 login every ~3 days over 30 days => sub-score 100
  ordersPerScore: 0.5,
  reservationsPerScore: 1,
  customerGrowthPerScore: 2,
  promotionsPerScore: 1,
  loyaltyPerScore: 1,
};
const TOTAL_TRACKED_FEATURES = 6; // catering, promotions, loyalty, delivery, inventory, reservations

function subScore(count: number, perScore: number): number {
  return Math.min(100, Math.round(count * perScore));
}

/**
 * Master Data Analytics spec's "Restaurant Engagement Score" (0-100,
 * weighted, admin-configurable signals — churn analytics section, and the
 * Action Center document's §17/§18). Computed live from the last 30 days
 * of real operational activity, weighted per
 * `PlatformAnalyticsConfig.engagementWeights`, and persisted as a
 * `RestaurantEngagementSnapshot` so score TRENDS are queryable without
 * recomputing history.
 *
 * Per the spec's explicit instruction: this score and its risk
 * classification are DECISION SUPPORT ONLY — nothing in this service (or
 * any caller of it) automatically cancels, suspends, or downgrades an
 * account based on it. The only side effect of a low score is an
 * ActionCenterTask asking a human to follow up.
 */
export class EngagementScoreService {
  static async computeForOrganization(organizationId: string) {
    const since = new Date(Date.now() - 30 * 86_400_000);

    const [logins, orders, reservations, newCustomers, promotionRedemptions, loyaltyAccounts, featuresUsed] =
      await Promise.all([
        prisma.auditLog.count({ where: { organizationId, action: 'auth.login', createdAt: { gte: since } } }),
        prisma.order.count({ where: { organizationId, createdAt: { gte: since } } }),
        prisma.reservation.count({ where: { organizationId, createdAt: { gte: since } } }),
        prisma.customer.count({ where: { organizationId, createdAt: { gte: since } } }),
        prisma.promotionRedemption.count({ where: { organizationId, redeemedAt: { gte: since } } }),
        prisma.loyaltyAccount.count({ where: { organizationId } }),
        this.featureAdoptionCount(organizationId),
      ]);

    const w = await PlatformAnalyticsConfigService.engagementWeights();

    const breakdown = {
      login: subScore(logins, SCALE.loginsPerScore),
      orders: subScore(orders, SCALE.ordersPerScore),
      reservations: subScore(reservations, SCALE.reservationsPerScore),
      customerGrowth: subScore(newCustomers, SCALE.customerGrowthPerScore),
      promotions: subScore(promotionRedemptions, SCALE.promotionsPerScore),
      loyalty: subScore(loyaltyAccounts, SCALE.loyaltyPerScore),
      featureAdoption: Math.round((featuresUsed / TOTAL_TRACKED_FEATURES) * 100),
    };

    const totalWeight = Object.values(w).reduce((s, v) => s + v, 0) || 1;
    const weightedScore =
      Object.entries(breakdown).reduce((sum, [key, sub]) => sum + sub * (w[key as keyof typeof w] ?? 0), 0) /
      totalWeight;

    const score = Math.max(0, Math.min(100, Math.round(weightedScore)));
    const classification = classify(score);

    return { score, classification, breakdown };
  }

  private static async featureAdoptionCount(organizationId: string): Promise<number> {
    const [catering, promotions, loyalty, delivery, inventory, reservationsFeature] = await Promise.all([
      prisma.cateringPackage.count({ where: { organizationId } }),
      prisma.promotion.count({ where: { organizationId } }),
      prisma.loyaltyAccount.count({ where: { organizationId } }),
      prisma.deliveryZone.count({ where: { organizationId } }),
      prisma.inventoryItem.count({ where: { organizationId } }),
      prisma.reservation.count({ where: { organizationId } }),
    ]);
    return [catering, promotions, loyalty, delivery, inventory, reservationsFeature].filter((c) => c > 0).length;
  }

  static async snapshotForOrganization(organizationId: string) {
    const { score, classification, breakdown } = await this.computeForOrganization(organizationId);
    const snapshot = await prisma.restaurantEngagementSnapshot.create({
      data: { organizationId, score, classification, breakdown },
    });

    // Master spec's churn-risk action (§18/§19 of the Action Center
    // document): AT_RISK/HIGH_RISK creates (or refreshes) a follow-up task.
    // Explicitly NOT an automatic cancellation/downgrade — see this
    // service's header.
    if (classification === 'AT_RISK' || classification === 'HIGH_RISK') {
      await ActionCenterService.createTask(prisma, {
        type: TASK_TYPES.CHURN_RISK,
        title: 'Restaurant retention follow-up required',
        description: `Engagement score ${score}/100 (${classification}). Breakdown: ${JSON.stringify(breakdown)}.`,
        priority: classification === 'HIGH_RISK' ? 'HIGH' : 'MEDIUM',
        organizationId,
        sourceModule: 'engagement',
      });
    }

    return snapshot;
  }

  /**
   * Snapshots every organization with an active-or-past-due subscription
   * (organizations with no subscription at all have nothing meaningful to
   * score yet). Request-triggered — no background scheduler exists in this
   * codebase, same documented limitation as `SubscriptionRetryService`.
   */
  static async snapshotAll() {
    const orgs = await prisma.organization.findMany({
      where: { subscription: { status: { in: ['ACTIVE', 'PAST_DUE', 'SUSPENDED'] } } },
      select: { id: true },
    });
    let computed = 0;
    for (const org of orgs) {
      await this.snapshotForOrganization(org.id);
      computed += 1;
    }
    return { computed };
  }

  static async trend(organizationId: string, limit = 90) {
    return prisma.restaurantEngagementSnapshot.findMany({
      where: { organizationId },
      orderBy: { computedAt: 'desc' },
      take: limit,
    });
  }

  static async atRiskRestaurants(limit = 50) {
    // Latest snapshot per organization, filtered to AT_RISK/HIGH_RISK.
    const latest = await prisma.restaurantEngagementSnapshot.findMany({
      orderBy: { computedAt: 'desc' },
      take: 1000,
      include: { organization: { select: { id: true, name: true } } },
    });
    const seen = new Set<string>();
    const result: typeof latest = [];
    for (const row of latest) {
      if (seen.has(row.organizationId)) continue;
      seen.add(row.organizationId);
      if (row.classification === 'AT_RISK' || row.classification === 'HIGH_RISK') result.push(row);
      if (result.length >= limit) break;
    }
    return result;
  }
}
