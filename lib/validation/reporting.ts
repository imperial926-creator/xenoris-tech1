import { z } from 'zod';
import { DATE_RANGE_PRESETS } from '@/lib/utils/timezone';

// Master spec §54 — every major report supports these date-range presets
// plus a branch filter. Re-exported from lib/utils/timezone (the single
// source of truth for what a preset resolves to) rather than duplicated.
export { DATE_RANGE_PRESETS };

export const reportDateRangeQuerySchema = z
  .object({
    preset: z.enum(DATE_RANGE_PRESETS).default('this_month'),
    startDate: z.string().trim().min(1).optional(),
    endDate: z.string().trim().min(1).optional(),
    branchId: z.string().trim().min(1).optional(),
  })
  .refine((v) => v.preset !== 'custom' || (v.startDate && v.endDate), {
    message: 'startDate and endDate are required when preset is "custom".',
    path: ['startDate'],
  });
export type ReportDateRangeQueryInput = z.infer<typeof reportDateRangeQuerySchema>;

export const balanceSheetQuerySchema = z.object({
  asOfDate: z.string().trim().min(1).optional(),
  branchId: z.string().trim().min(1).optional(),
});
export type BalanceSheetQueryInput = z.infer<typeof balanceSheetQuerySchema>;

export const financialDashboardQuerySchema = z.object({
  branchId: z.string().trim().min(1).optional(),
});
export type FinancialDashboardQueryInput = z.infer<typeof financialDashboardQuerySchema>;
