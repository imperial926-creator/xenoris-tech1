import { reportDateRangeQuerySchema } from '@/lib/validation/reporting';
import { z } from 'zod';

/**
 * Phase 13 — AI Business Intelligence. Insights and the revenue forecast
 * both take the exact same `{ preset, startDate, endDate, branchId }` query
 * shape Phase 11/12 already validate with — re-exported rather than
 * redefined, same reasoning lib/validation/analytics.ts already gives:
 * "today"/"this month"/etc. mean the same thing everywhere in this app.
 */
export const aiInsightsQuerySchema = reportDateRangeQuerySchema;
export type { ReportDateRangeQueryInput as AiInsightsQueryInput } from '@/lib/validation/reporting';

/**
 * The forecast route takes the same date-range query (it uses the range to
 * pick which historical trend to project from) plus an optional
 * `periodsAhead` — how many additional buckets beyond the observed range to
 * project. Bounded 1-6: master spec's "forecasting where appropriate"
 * hedge is taken seriously here — a naive linear projection more than a
 * handful of buckets out stops being "appropriate" and starts being
 * fiction, so the API itself refuses to go further than
 * InsightService.forecastRevenue's own documented cap.
 */
export const aiForecastQuerySchema = reportDateRangeQuerySchema.and(
  z.object({
    periodsAhead: z.coerce.number().int().min(1).max(6).default(1),
  }),
);
export type AiForecastQueryInput = z.infer<typeof aiForecastQuerySchema>;
