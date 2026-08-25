import 'server-only';
import { prisma } from '@/lib/db/prisma';

const SINGLETON_ID = 'singleton';

export interface EngagementWeights {
  login: number;
  orders: number;
  reservations: number;
  customerGrowth: number;
  promotions: number;
  loyalty: number;
  featureAdoption: number;
}

/**
 * Singleton config row (same convention as `PlatformBillingConfigService`)
 * for every admin-configurable number the Data Analytics + Action Center
 * spec calls out: engagement-score weights, anomaly-detection sensitivity,
 * complaint SLA hours, renewal-reminder schedule, inactivity threshold.
 */
export class PlatformAnalyticsConfigService {
  static async get() {
    return prisma.platformAnalyticsConfig.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
  }

  static async update(
    changes: {
      engagementWeights?: EngagementWeights;
      anomalyThresholdPercent?: number;
      complaintSlaHours?: number;
      renewalReminderDays?: number[];
      inactivityDaysThreshold?: number;
    },
    updatedByAdminId: string,
  ) {
    await this.get(); // ensure the row exists first
    return prisma.platformAnalyticsConfig.update({
      where: { id: SINGLETON_ID },
      data: {
        ...(changes.engagementWeights ? { engagementWeights: changes.engagementWeights } : {}),
        ...(changes.anomalyThresholdPercent !== undefined ? { anomalyThresholdPercent: changes.anomalyThresholdPercent } : {}),
        ...(changes.complaintSlaHours !== undefined ? { complaintSlaHours: changes.complaintSlaHours } : {}),
        ...(changes.renewalReminderDays ? { renewalReminderDays: changes.renewalReminderDays } : {}),
        ...(changes.inactivityDaysThreshold !== undefined ? { inactivityDaysThreshold: changes.inactivityDaysThreshold } : {}),
        updatedByAdminId,
      },
    });
  }

  static async engagementWeights(): Promise<EngagementWeights> {
    const config = await this.get();
    return config.engagementWeights as unknown as EngagementWeights;
  }
}
