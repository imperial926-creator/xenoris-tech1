import { z } from 'zod';
import { PLATFORM_DATE_RANGE_PRESETS } from '@/lib/platform-analytics/date-range';

export const platformDateRangeQuerySchema = z
  .object({
    preset: z.enum(PLATFORM_DATE_RANGE_PRESETS).default('last_30_days'),
    customStart: z.coerce.date().optional(),
    customEnd: z.coerce.date().optional(),
    compare: z.coerce.boolean().optional().default(false),
  })
  .refine((v) => v.preset !== 'custom' || (v.customStart && v.customEnd), {
    message: 'customStart and customEnd are required when preset is "custom".',
  });
export type PlatformDateRangeQueryInput = z.infer<typeof platformDateRangeQuerySchema>;

export const createComplaintSchema = z.object({
  organizationId: z.string().min(1),
  raisedByUserId: z.string().min(1).optional(),
  category: z.enum(['BILLING', 'TECHNICAL', 'SERVICE_QUALITY', 'FEATURE_REQUEST', 'ACCOUNT', 'OTHER']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  subject: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  slaHours: z.number().int().positive().max(24 * 30).optional(),
});

export const updateComplaintSchema = z.object({
  status: z.enum(['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED']).optional(),
  assignedToAdminId: z.string().min(1).nullable().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  resolutionNotes: z.string().max(5000).optional(),
});

export const actionCenterTaskFilterSchema = z.object({
  status: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  type: z.string().optional(),
  assignedToAdminId: z.string().optional(),
  organizationId: z.string().optional(),
  overdue: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

export const assignActionCenterTaskSchema = z.object({
  assignedToAdminId: z.string().min(1).nullable(),
});

export const updateActionCenterTaskStatusSchema = z.object({
  status: z.enum([
    'OPEN',
    'NEW',
    'ACKNOWLEDGED',
    'ASSIGNED',
    'IN_PROGRESS',
    'WAITING',
    'FOLLOW_UP_REQUIRED',
    'ESCALATED',
    'RESOLVED',
    'CLOSED',
    'DISMISSED',
    'CANCELLED',
  ]),
  resolutionNotes: z.string().max(5000).optional(),
});

export const addActionCenterNoteSchema = z.object({
  note: z.string().min(1).max(5000),
});

export const scheduleFollowUpSchema = z.object({
  nextFollowUpAt: z.coerce.date(),
  followUpMethod: z.enum(['PHONE', 'EMAIL', 'SMS', 'IN_APP', 'PUSH', 'WHATSAPP', 'VIDEO_CALL', 'MEETING', 'INTERNAL_NOTE']),
});

export const savedReportConfigSchema = z.object({
  metric: z.string().min(1),
  groupBy: z.string().optional(),
  dateRange: platformDateRangeQuerySchema.optional(),
  filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  chartType: z.enum(['table', 'line', 'bar', 'pie']).default('table'),
});

export const createSavedReportSchema = z.object({
  name: z.string().min(1).max(200),
  config: savedReportConfigSchema,
  scheduleCron: z.string().max(100).optional(),
});

export const exportRequestSchema = z.object({
  reportType: z.string().min(1),
  format: z.enum(['csv', 'json']),
  filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const updatePlatformAnalyticsConfigSchema = z.object({
  engagementWeights: z
    .object({
      login: z.number().min(0).max(100),
      orders: z.number().min(0).max(100),
      reservations: z.number().min(0).max(100),
      customerGrowth: z.number().min(0).max(100),
      promotions: z.number().min(0).max(100),
      loyalty: z.number().min(0).max(100),
      featureAdoption: z.number().min(0).max(100),
    })
    .optional(),
  anomalyThresholdPercent: z.number().int().min(1).max(500).optional(),
  complaintSlaHours: z.number().int().min(1).max(720).optional(),
  renewalReminderDays: z.array(z.number().int().min(0)).optional(),
  inactivityDaysThreshold: z.number().int().min(1).max(365).optional(),
});

export const createAlertRuleSchema = z.object({
  name: z.string().min(1).max(200),
  metricKey: z.string().min(1),
  comparisonOperator: z.enum(['GT', 'LT', 'GTE', 'LTE']),
  thresholdValue: z.number(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  enabled: z.boolean().default(true),
});
