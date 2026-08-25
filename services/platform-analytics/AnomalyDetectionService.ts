import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { ActionCenterService, TASK_TYPES } from '@/services/platform-billing/ActionCenterService';
import { PlatformAnalyticsConfigService } from './PlatformAnalyticsConfigService';

export type AnomalyLevel = 'NORMAL' | 'UNUSUAL' | 'HIGH_ANOMALY' | 'CRITICAL';

/**
 * Master Data Analytics spec §72's anomaly detection: compare a metric's
 * current-period value against its immediately-preceding period of equal
 * length, classify the percent change against a configurable threshold.
 * Explicitly NOT permitted to take destructive action automatically (same
 * document, same section) — the only side effect here is an
 * `ActionCenterTask` for HIGH_ANOMALY/CRITICAL, never an automatic
 * suspension/cancellation/refund.
 */
export function classifyAnomaly(percentChange: number | null, thresholdPercent: number): AnomalyLevel {
  if (percentChange === null) return 'NORMAL';
  const abs = Math.abs(percentChange);
  if (abs >= thresholdPercent * 3) return 'CRITICAL';
  if (abs >= thresholdPercent * 2) return 'HIGH_ANOMALY';
  if (abs >= thresholdPercent) return 'UNUSUAL';
  return 'NORMAL';
}

interface MetricCheck {
  key: string;
  label: string;
  current: number;
  previous: number;
}

export class AnomalyDetectionService {
  /**
   * Checks a small, honest set of platform-wide metrics this codebase can
   * actually compute (payment failures, new complaints, technical
   * incidents) over the last 24h vs the preceding 24h. A comprehensive
   * anomaly sweep across every metric in `PlatformAnalyticsService` would
   * need a scheduled job to run continuously; this codebase has no job
   * runner (documented limitation, same as `SubscriptionRetryService`), so
   * this is request-triggered from the Platform Health dashboard and the
   * cron route below.
   */
  static async runDailySweep() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 86_400_000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 86_400_000);
    const config = await PlatformAnalyticsConfigService.get();

    const [
      paymentFailuresToday,
      paymentFailuresYesterday,
      complaintsToday,
      complaintsYesterday,
      technicalToday,
      technicalYesterday,
    ] = await Promise.all([
      prisma.subscriptionPayment.count({ where: { status: 'FAILED', createdAt: { gte: oneDayAgo } } }),
      prisma.subscriptionPayment.count({ where: { status: 'FAILED', createdAt: { gte: twoDaysAgo, lt: oneDayAgo } } }),
      prisma.complaint.count({ where: { createdAt: { gte: oneDayAgo } } }),
      prisma.complaint.count({ where: { createdAt: { gte: twoDaysAgo, lt: oneDayAgo } } }),
      prisma.platformHealthEvent.count({ where: { createdAt: { gte: oneDayAgo } } }),
      prisma.platformHealthEvent.count({ where: { createdAt: { gte: twoDaysAgo, lt: oneDayAgo } } }),
    ]);

    const checks: MetricCheck[] = [
      { key: 'payment_failures', label: 'Failed subscription payments (24h)', current: paymentFailuresToday, previous: paymentFailuresYesterday },
      { key: 'new_complaints', label: 'New complaints (24h)', current: complaintsToday, previous: complaintsYesterday },
      { key: 'technical_incidents', label: 'Platform health events (24h)', current: technicalToday, previous: technicalYesterday },
    ];

    const results = [];
    for (const check of checks) {
      const pctChange = check.previous === 0 ? (check.current > 0 ? 100 : null) : ((check.current - check.previous) / check.previous) * 100;
      const level = classifyAnomaly(pctChange, config.anomalyThresholdPercent);
      results.push({ ...check, percentChange: pctChange, level });

      if (level === 'HIGH_ANOMALY' || level === 'CRITICAL') {
        await ActionCenterService.createTask(prisma, {
          type: TASK_TYPES.SYSTEM_ALERT,
          title: `Anomaly detected: ${check.label}`,
          description: `${check.current} vs ${check.previous} in the prior period (${pctChange?.toFixed(0) ?? 'n/a'}% change).`,
          priority: level === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
          sourceModule: 'anomaly_detection',
        });
      }
    }

    return results;
  }
}
