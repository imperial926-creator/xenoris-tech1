import { reportDateRangeQuerySchema } from '@/lib/validation/reporting';

/**
 * Phase 12 — Owner Analytics. Every analytics route takes the exact same
 * `{ preset, startDate, endDate, branchId }` query shape Phase 11's report
 * routes already validate with — re-exported rather than redefined so
 * "what does `preset=this_month` mean" has exactly one answer across
 * Finance and Analytics.
 */
export const analyticsQuerySchema = reportDateRangeQuerySchema;
export type { ReportDateRangeQueryInput as AnalyticsQueryInput } from '@/lib/validation/reporting';
