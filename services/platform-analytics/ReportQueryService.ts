import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError } from '@/lib/utils/api-error';
import { PlatformAnalyticsService } from './PlatformAnalyticsService';
import { SubscriptionAnalyticsService } from '@/services/platform-billing/SubscriptionAnalyticsService';
import { ComplaintService } from './ComplaintService';
import { ActionCenterService } from '@/services/platform-billing/ActionCenterService';

/**
 * Master Data Analytics spec's "Custom Report Builder" (ADMIN → CUSTOM
 * REPORTS). Deliberately NOT an arbitrary-SQL/drag-and-drop query engine —
 * see the Phase 18 header comment in schema.prisma for why (tenant-
 * isolation risk, and the spec's own "avoid unnecessary complexity"
 * instruction). `METRIC_CATALOG` is the fixed, reviewed set of queryable
 * metrics; a `SavedReport.config.metric` must be one of these keys.
 */
export const METRIC_CATALOG = {
  saas_revenue: 'SaaS subscription revenue (MRR/ARR/movement)',
  restaurant_gross_sales: 'Restaurant transaction value (never combined with saas_revenue)',
  subscriptions: 'Subscription counts by status, churn rate',
  plan_popularity: 'Active subscribers per plan',
  complaints: 'Complaint volume, resolution rate, by category/priority',
  action_center: 'Action Center task volume, resolution rate, by priority',
  feature_usage: 'Feature usage ranking',
  app_usage: 'Customer app DAU/WAU/MAU',
  top_restaurants_by_mrr: 'Top restaurants ranked by MRR contribution',
} as const;
export type MetricKey = keyof typeof METRIC_CATALOG;

export class ReportQueryService {
  static async run(metric: MetricKey, range: { startDate: Date; endDate: Date }) {
    switch (metric) {
      case 'saas_revenue':
        return PlatformAnalyticsService.revenueAnalytics(range);
      case 'restaurant_gross_sales':
        return PlatformAnalyticsService.restaurantGrossSales(range);
      case 'subscriptions':
        return SubscriptionAnalyticsService.subscriptionAnalytics();
      case 'plan_popularity':
        return PlatformAnalyticsService.planPopularity();
      case 'complaints':
        return ComplaintService.complaintAnalytics(range);
      case 'action_center':
        return ActionCenterService.actionAnalytics(range);
      case 'feature_usage':
        return PlatformAnalyticsService.featureUsageRanking(range);
      case 'app_usage':
        return PlatformAnalyticsService.appUsageAnalytics(range.endDate);
      case 'top_restaurants_by_mrr':
        return PlatformAnalyticsService.topRestaurantsByMrr();
      default: {
        const exhaustive: never = metric;
        throw new Error(`Unknown metric: ${exhaustive as string}`);
      }
    }
  }

  static async createSavedReport(params: {
    name: string;
    config: { metric: MetricKey; groupBy?: string; filters?: Record<string, unknown>; chartType: string };
    scheduleCron?: string;
    createdByAdminId: string;
  }) {
    return prisma.savedReport.create({
      data: {
        name: params.name,
        config: params.config,
        scheduleCron: params.scheduleCron,
        createdByAdminId: params.createdByAdminId,
      },
    });
  }

  static async listSavedReports(createdByAdminId?: string) {
    return prisma.savedReport.findMany({
      where: createdByAdminId ? { createdByAdminId } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getSavedReport(id: string) {
    const report = await prisma.savedReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundError('Saved report');
    return report;
  }

  static async deleteSavedReport(id: string) {
    await prisma.savedReport.delete({ where: { id } });
  }

  /** Executes a saved report's config and stamps `lastRunAt`. */
  static async runSavedReport(id: string, range: { startDate: Date; endDate: Date }) {
    const report = await this.getSavedReport(id);
    const config = report.config as { metric: MetricKey };
    const result = await this.run(config.metric, range);
    await prisma.savedReport.update({ where: { id }, data: { lastRunAt: new Date() } });
    return result;
  }
}
