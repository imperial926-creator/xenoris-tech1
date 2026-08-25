import { z } from 'zod';

const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Must be a valid monetary value.');

const positiveMoneyString = moneyString.refine((v) => Number(v) > 0, 'Must be a positive monetary value.');

// --- SaaS Owner / Platform Admin: subscription plan catalog (master spec §7) ---

export const createSubscriptionPlanSchema = z.object({
  planCode: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  monthlyPrice: positiveMoneyString,
  promoPrice: moneyString.optional(),
  promoValidUntil: z.coerce.date().optional(),
  billingIntervalMonths: z.number().int().min(1).max(24).default(1),
  currency: z.string().trim().length(3).default('PHP'),
  features: z.array(z.string().trim().min(1)).default([]),
  usageLimits: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  displayOrder: z.number().int().min(0).default(0),
});
export type CreateSubscriptionPlanInput = z.infer<typeof createSubscriptionPlanSchema>;

export const updateSubscriptionPlanSchema = createSubscriptionPlanSchema.partial().extend({
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
export type UpdateSubscriptionPlanInput = z.infer<typeof updateSubscriptionPlanSchema>;

// --- Restaurant owner: subscribing ---

export const createSubscriptionCheckoutSchema = z.object({
  planId: z.string().trim().min(1),
});
export type CreateSubscriptionCheckoutInput = z.infer<typeof createSubscriptionCheckoutSchema>;

// --- SaaS Owner / Platform Admin: billing configuration (master spec §52-53) ---

export const updatePlatformBillingConfigSchema = z.object({
  paymentProvider: z.string().trim().min(1).max(60).optional(),
  environment: z.enum(['TEST', 'LIVE']).optional(),
  recurringBillingEnabled: z.boolean().optional(),
  // Deliberately the ONLY settlement-related fields this schema accepts —
  // never a full account number. Master spec §4/§53: "for display purposes
  // in the SaaS Owner's private administration panel, use masked
  // information only." The real account is configured directly at the
  // payment provider's own merchant dashboard, not through this app.
  settlementBankName: z.string().trim().max(120).optional(),
  settlementAccountLast4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'Must be exactly the last 4 digits.')
    .optional(),
  smsNotificationsEnabled: z.boolean().optional(),
  smsNotificationNumber: z
    .string()
    .trim()
    .regex(/^\+\d{9,15}$/, 'Must be an E.164 phone number, e.g. +639171234567.')
    .optional(),
  retryIntervalDays: z.array(z.number().int().min(1).max(60)).min(1).max(10).optional(),
  gracePeriodDays: z.number().int().min(0).max(90).optional(),
});
export type UpdatePlatformBillingConfigInput = z.infer<typeof updatePlatformBillingConfigSchema>;

// --- SaaS Owner / Platform Admin: refunds (master spec §39) ---

export const issueRefundSchema = z.object({
  paymentId: z.string().trim().min(1),
  amount: positiveMoneyString.optional(),
  reason: z.string().trim().min(1).max(500),
});
export type IssueRefundInput = z.infer<typeof issueRefundSchema>;

// --- SaaS Owner / Platform Admin: action center (master spec §45) ---

export const resolveActionCenterTaskSchema = z.object({
  resolutionNote: z.string().trim().max(500).optional(),
});
export type ResolveActionCenterTaskInput = z.infer<typeof resolveActionCenterTaskSchema>;

// --- Platform admin login ---

export const platformAdminLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});
export type PlatformAdminLoginInput = z.infer<typeof platformAdminLoginSchema>;
