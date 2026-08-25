import 'server-only';
import { resolveDateRangePreset, type DateRangePreset } from '@/lib/utils/timezone';
import { previousPeriod } from '@/services/analytics/AnalyticsService';

/**
 * Master Data Analytics spec's date-range filter component (§ "reusable
 * across every analytics report"): Today/Yesterday/Last 7/30/90 days/This-
 * Previous month/quarter/year/custom/compare-with-previous-period. Every
 * platform-admin analytics endpoint takes this same shape.
 *
 * Every OTHER analytics module in this codebase (`services/analytics`,
 * `services/reporting`) resolves date presets against a specific
 * Organization's own `timezone` column, because those dashboards belong to
 * one restaurant. Platform-wide analytics has no single organization to
 * borrow a timezone from, so this module evaluates presets against a fixed
 * platform default instead. Per the master spec's explicit instruction
 * that the Philippine-market defaults must not permanently limit the
 * architecture, this is a single named constant — not logic hard-coded
 * against "Philippines" anywhere — so a future multi-region deployment can
 * swap it (or make it admin-configurable) without touching every call
 * site.
 */
export const PLATFORM_DEFAULT_TIMEZONE = 'Asia/Manila';

export const PLATFORM_DATE_RANGE_PRESETS = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'this_month',
  'last_month',
  'this_quarter',
  'this_year',
  'custom',
] as const;
export type PlatformDateRangePreset = (typeof PLATFORM_DATE_RANGE_PRESETS)[number];

export interface PlatformDateRange {
  startDate: Date;
  endDate: Date;
}

/** Resolves a preset (§ date-range filter) into a concrete [start, end] instant pair. */
export function resolvePlatformDateRange(
  preset: PlatformDateRangePreset,
  now: Date,
  customStart?: Date,
  customEnd?: Date,
): PlatformDateRange {
  if (preset === 'last_7_days' || preset === 'last_30_days' || preset === 'last_90_days') {
    const days = preset === 'last_7_days' ? 7 : preset === 'last_30_days' ? 30 : 90;
    return { startDate: new Date(now.getTime() - days * 86_400_000), endDate: now };
  }
  // Every other preset maps directly onto the existing owner-analytics
  // preset resolver — same day/week/month/quarter/year boundary logic,
  // just evaluated against the platform default timezone instead of an
  // organization's.
  return resolveDateRangePreset(
    preset as DateRangePreset,
    PLATFORM_DEFAULT_TIMEZONE,
    now,
    customStart,
    customEnd,
  );
}

/** The immediately-preceding period of equal length — for "compare with previous period". */
export function platformPreviousPeriod(range: PlatformDateRange): PlatformDateRange {
  return previousPeriod(range.startDate, range.endDate);
}

export { percentChange } from '@/services/analytics/AnalyticsService';
