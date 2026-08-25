/**
 * CAPP Phase 9 — anti-spam configuration (spec § 51: "frequency limits,"
 * "campaign throttling," "quiet hours where appropriate," "restaurant-level
 * sending limits"). Reads `Organization.customerAppSettings.notifications`,
 * the same "JSON column code supplies defaults for" pattern
 * `lib/crm/rfm.ts`'s `resolveRfmThresholds` already established for
 * `crmSettings.rfmThresholds` — no new schema column for a handful of
 * restaurant-tunable numbers, matching architecture.md § 2's reuse decision
 * for `customerAppSettings` itself.
 */

interface CustomerNotificationSettings {
  /**
   * Spec § 51 "Frequency limits" / "Campaign throttling": a customer who
   * already received a PROMOTION-category notification (any campaign)
   * within this many hours has their PUSH/EMAIL/SMS channels suppressed for
   * a new one — the in-app CustomerNotification row is still written, so
   * nothing is silently lost from their notification center, only the
   * interruptive channels are held back. Default 24h.
   */
  promotionalFrequencyLimitHours: number;
  /**
   * Spec § 51 "Quiet hours where appropriate": `NotificationDispatchService`
   * won't attempt a PUSH/EMAIL/SMS send while the restaurant's local clock
   * (Asia/Manila, this build's PH-market default — same convention
   * `NotificationService.formatDateTime` already uses) falls in
   * [quietHoursStartHour, quietHoursEndHour). Either can be null to disable
   * the check entirely. Defaults to 9pm-8am.
   */
  quietHoursStartHour: number | null;
  quietHoursEndHour: number | null;
  /**
   * Spec § 33 "Use a background job/queue system... do not send thousands
   * of notifications directly inside a web request": the max QUEUED rows
   * `NotificationDispatchService.dispatchQueued` processes in one call —
   * this build has no real worker to size a queue for, so this stands in
   * as the batch-size cap on each manual/future-scheduled invocation.
   * Default 200.
   */
  dispatchBatchSize: number;
}

const DEFAULTS: CustomerNotificationSettings = {
  promotionalFrequencyLimitHours: 24,
  quietHoursStartHour: 21,
  quietHoursEndHour: 8,
  dispatchBatchSize: 200,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function resolveCustomerNotificationSettings(customerAppSettings: unknown): CustomerNotificationSettings {
  const raw = isRecord(customerAppSettings) && isRecord(customerAppSettings.notifications) ? customerAppSettings.notifications : {};
  return {
    promotionalFrequencyLimitHours: numberOrDefault(raw.promotionalFrequencyLimitHours, DEFAULTS.promotionalFrequencyLimitHours),
    quietHoursStartHour: raw.quietHoursStartHour === null ? null : numberOrDefault(raw.quietHoursStartHour, DEFAULTS.quietHoursStartHour ?? 21),
    quietHoursEndHour: raw.quietHoursEndHour === null ? null : numberOrDefault(raw.quietHoursEndHour, DEFAULTS.quietHoursEndHour ?? 8),
    dispatchBatchSize: numberOrDefault(raw.dispatchBatchSize, DEFAULTS.dispatchBatchSize),
  };
}

/**
 * True when `now` (Asia/Manila local time) falls inside the configured
 * quiet-hours window. Handles the overnight-wrap case (e.g. 21 -> 8) the
 * same way a same-day window (e.g. 1 -> 5) works, without a separate branch
 * — both are just "is the current hour in this circular range."
 */
export function isWithinQuietHours(settings: CustomerNotificationSettings, now: Date): boolean {
  if (settings.quietHoursStartHour === null || settings.quietHoursEndHour === null) return false;
  const hour = Number(
    new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', hour12: false }).format(now),
  ) % 24;
  const { quietHoursStartHour: start, quietHoursEndHour: end } = settings;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
