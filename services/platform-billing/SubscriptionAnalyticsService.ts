import 'server-only';
import { prisma } from '@/lib/db/prisma';

/**
 * Master spec §44/§46/§47's payment + subscription analytics. Every number
 * here is computed live from `SubscriptionPayment`/`Subscription` rows on
 * each request rather than maintained as a running counter updated by
 * SubscriptionWebhookService — this dataset (one row per organization's
 * subscription) is small enough that a live aggregate query is simpler and
 * strictly more correct than keeping a denormalized counter in sync across
 * every code path that touches these tables (checkout, webhook success,
 * webhook failure, refund, cancellation, retry). The same choice
 * `services/analytics` makes elsewhere in this codebase for owner-facing
 * dashboards.
 */
export class SubscriptionAnalyticsService {
  static async paymentAnalytics(range?: { from: Date; to: Date }) {
    const where = range ? { createdAt: { gte: range.from, lte: range.to } } : {};

    const [total, succeeded, failed, refunded, sumResult] = await Promise.all([
      prisma.subscriptionPayment.count({ where }),
      prisma.subscriptionPayment.count({ where: { ...where, status: 'SUCCEEDED' } }),
      prisma.subscriptionPayment.count({ where: { ...where, status: 'FAILED' } }),
      prisma.subscriptionPayment.count({ where: { ...where, status: 'REFUNDED' } }),
      prisma.subscriptionPayment.aggregate({
        where: { ...where, status: 'SUCCEEDED' },
        _sum: { amount: true },
        _avg: { amount: true },
      }),
    ]);

    // "Recovered" = a SUCCEEDED payment whose attempt number is > 1, i.e.
    // it followed at least one FAILED attempt for the same subscription.
    const recovered = await prisma.subscriptionPayment.count({
      where: { ...where, status: 'SUCCEEDED', paymentAttempt: { gt: 1 } },
    });

    const grossRevenue = sumResult._sum.amount?.toFixed(2) ?? '0.00';
    // Master spec §43: gateway processing fees are only tracked "where
    // available" from the provider — nothing in this build's unconfigured
    // gateway supplies a fee figure, so net revenue equals gross until a
    // real provider reports fees (see PlatformBillingConfig's header on
    // the same "don't fake it" principle).
    const netRevenue = grossRevenue;

    return {
      totalPayments: total,
      successfulPayments: succeeded,
      failedPayments: failed,
      refunds: refunded,
      recoveredPayments: recovered,
      paymentSuccessRate: total > 0 ? Number(((succeeded / total) * 100).toFixed(1)) : 0,
      paymentFailureRate: total > 0 ? Number(((failed / total) * 100).toFixed(1)) : 0,
      paymentRecoveryRate: failed > 0 ? Number(((recovered / failed) * 100).toFixed(1)) : 0,
      averagePaymentValue: sumResult._avg.amount?.toFixed(2) ?? '0.00',
      grossRevenue,
      netRevenue,
    };
  }

  static async subscriptionAnalytics() {
    const [active, pastDue, suspended, cancelled, incomplete] = await Promise.all([
      prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      prisma.subscription.count({ where: { status: 'PAST_DUE' } }),
      prisma.subscription.count({ where: { status: 'SUSPENDED' } }),
      prisma.subscription.count({ where: { status: 'CANCELLED' } }),
      prisma.subscription.count({ where: { status: 'INCOMPLETE' } }),
    ]);

    // MRR: sum each active subscription's plan price, normalized to a
    // monthly figure (a quarterly plan's price divided by 3, etc.) — the
    // normalization master spec §1/§64 requires supporting non-monthly
    // billing intervals implies for a meaningful MRR figure.
    const activeSubs = await prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
      include: { plan: true },
    });
    const mrr = activeSubs.reduce((sum, sub) => {
      const monthly = Number(sub.plan.monthlyPrice) / Math.max(1, sub.billingIntervalMonths);
      return sum + monthly;
    }, 0);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const [newSubscriptions, cancellations] = await Promise.all([
      prisma.subscription.count({ where: { startDate: { gte: thirtyDaysAgo } } }),
      prisma.subscription.count({ where: { cancelledAt: { gte: thirtyDaysAgo } } }),
    ]);

    const totalEverActivated = active + pastDue + suspended + cancelled;
    const churnRate = totalEverActivated > 0 ? Number(((cancellations / totalEverActivated) * 100).toFixed(1)) : 0;

    return {
      activeSubscriptions: active,
      pastDueSubscriptions: pastDue,
      suspendedSubscriptions: suspended,
      cancelledSubscriptions: cancelled,
      incompleteSubscriptions: incomplete,
      newSubscriptionsLast30Days: newSubscriptions,
      cancellationsLast30Days: cancellations,
      churnRate,
      mrr: mrr.toFixed(2),
      arr: (mrr * 12).toFixed(2),
      averageRevenuePerRestaurant: active > 0 ? (mrr / active).toFixed(2) : '0.00',
    };
  }
}
