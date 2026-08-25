import { z } from 'zod';
import { paginationQuerySchema } from '@/lib/validation/pagination';

// Matches schema.prisma's PromotionDiscountType/PromotionStatus/
// CampaignStatus/PromotionAudienceType exactly (spec § 18/§ 28/§ 19).
export const PROMOTION_DISCOUNT_TYPES = [
  'PERCENTAGE', 'FIXED_AMOUNT', 'BOGO', 'FREE_ITEM', 'BUNDLE', 'FREE_DELIVERY', 'FREE_ADDON',
  'CATERING_DISCOUNT', 'RESERVATION_DISCOUNT', 'LOYALTY_REWARD', 'FIRST_ORDER', 'REPEAT_CUSTOMER',
  'BIRTHDAY', 'CUSTOMER_SPECIFIC',
] as const;
export const PROMOTION_STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED'] as const;
export const CAMPAIGN_STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const;
export const PROMOTION_AUDIENCE_TYPES = [
  'ALL', 'NEW', 'RETURNING', 'LOYAL', 'INACTIVE', 'ORDERED_ITEMS', 'MADE_RESERVATIONS',
  'ORDERED_DELIVERY', 'ORDERED_TAKEOUT', 'BOOKED_CATERING', 'INACTIVE_DAYS', 'LOCATION',
  'LOYALTY_TIER', 'SEGMENT',
] as const;
// Spec § 17's "Eligible services" — OrderType values plus the two flows a
// discount type can reference that aren't an Order at all.
export const PROMOTION_ELIGIBLE_SERVICES = ['DINE_IN', 'TAKEOUT', 'DELIVERY', 'RESERVATION', 'CATERING'] as const;

// Decimal-as-string in, Decimal out via Prisma — same pattern as every other
// validation file in this codebase.
const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Must be a non-negative amount with up to 2 decimal places.');
const positiveMoneyString = moneyString.refine((v) => Number(v) > 0, 'Must be a positive amount.');

const timeOfDay = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM (24-hour).');

// Base object shape, kept separate from the cross-field `.refine()`s below
// so `updatePromotionSchema` can `.partial()` it directly — Zod's
// `.refine()` returns a `ZodEffects` wrapper that `.partial()`/`.extend()`
// can't be called on.
const promotionBaseSchema = z.object({
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).optional(),
  imageUrl: z.string().trim().url().max(2000).optional(),
  promoCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(3)
    .max(40)
    .regex(/^[A-Z0-9_-]+$/, 'Promo codes may only contain letters, numbers, hyphens, and underscores.')
    .optional(),
  discountType: z.enum(PROMOTION_DISCOUNT_TYPES),
  // PERCENTAGE is a 0-100 rate; every other type is a peso amount. Cross-
  // field, so it can't be a single regex — enforced in the .refine below.
  discountValue: moneyString,
  minimumOrderValue: moneyString.optional(),
  maximumDiscount: moneyString.optional(),
  startAt: z.string().trim().min(1),
  endAt: z.string().trim().min(1).optional(),
  startTimeOfDay: timeOfDay.optional(),
  endTimeOfDay: timeOfDay.optional(),
  eligibleServices: z.array(z.enum(PROMOTION_ELIGIBLE_SERVICES)).default([]),
  eligibleMenuItemIds: z.array(z.string().trim().min(1)).default([]),
  eligibleCategoryIds: z.array(z.string().trim().min(1)).default([]),
  usageLimit: z.number().int().min(1).max(1_000_000).optional(),
  customerUsageLimit: z.number().int().min(1).max(1000).optional(),
  terms: z.string().trim().max(2000).optional(),
  // CAPP Phase 10 — required only for discountType: 'LOYALTY_REWARD' (see
  // the cross-field refine below); ignored for every other type.
  loyaltyPointsCost: z.number().int().min(1).max(1_000_000).optional(),
});

// Loosely-typed on purpose: this runs against both the full create shape
// and its `.partial()` update variant, which have different (structurally
// incompatible) inferred TS types even though the runtime values are the
// same shape with more fields optional.
interface PromotionCrossFields {
  discountType?: (typeof PROMOTION_DISCOUNT_TYPES)[number];
  discountValue?: string;
  startTimeOfDay?: string;
  endTimeOfDay?: string;
  loyaltyPointsCost?: number;
}

function refinePromotion<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine(
      (v: PromotionCrossFields) =>
        v.discountType !== 'PERCENTAGE' || v.discountValue === undefined || Number(v.discountValue) <= 100,
      { message: 'A PERCENTAGE discount cannot exceed 100.', path: ['discountValue'] },
    )
    .refine((v: PromotionCrossFields) => !v.startTimeOfDay === !v.endTimeOfDay, {
      message: 'startTimeOfDay and endTimeOfDay must be set together.',
      path: ['endTimeOfDay'],
    })
    // CAPP Phase 10 — only fires when discountType is present in this
    // payload and is LOYALTY_REWARD, same "cross-field, partial-update-safe"
    // shape as the PERCENTAGE refine above: an update that doesn't touch
    // discountType is never blocked by this, even if loyaltyPointsCost was
    // already set on the existing record and isn't repeated here.
    .refine((v: PromotionCrossFields) => v.discountType !== 'LOYALTY_REWARD' || v.loyaltyPointsCost !== undefined, {
      message: 'loyaltyPointsCost is required for discountType LOYALTY_REWARD.',
      path: ['loyaltyPointsCost'],
    });
}

export const createPromotionSchema = refinePromotion(promotionBaseSchema);
export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;

// A promotion's discountType/discountValue math is load-bearing for every
// past redemption's already-recorded discountAmount — editing it doesn't
// rewrite history (same "menu price changes don't rewrite old orders"
// principle as OrderItem's snapshot fields), so updates are allowed freely;
// nothing here needs a narrower "only while DRAFT" rule the way
// CateringQuote's edit restriction does.
export const updatePromotionSchema = refinePromotion(promotionBaseSchema.partial());
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;

export const updatePromotionStatusSchema = z.object({
  status: z.enum(PROMOTION_STATUSES),
});
export type UpdatePromotionStatusInput = z.infer<typeof updatePromotionStatusSchema>;

export const listPromotionsQuerySchema = z
  .object({
    status: z.enum(PROMOTION_STATUSES).optional(),
  })
  .merge(paginationQuerySchema);
export type ListPromotionsQueryInput = z.infer<typeof listPromotionsQuerySchema>;

// CAPP Phase 12 hardening (performance audit): `CustomerPromotionService.listMine`
// ("my offers" — every promotion a diner has ever claimed/redeemed at this
// restaurant) was an unbounded `findMany`, the same gap the favorites lists
// had. A long-tenured diner across many campaigns gets everything back in
// one response otherwise.
export const listMyPromotionsQuerySchema = paginationQuerySchema;
export type ListMyPromotionsQueryInput = z.infer<typeof listMyPromotionsQuerySchema>;

// --- Campaigns --------------------------------------------------------------

export const createCampaignSchema = z.object({
  promotionId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(150),
  audienceType: z.enum(PROMOTION_AUDIENCE_TYPES),
  // Type-specific — validated against `audienceType` at the service layer
  // (PromotionCampaignService.assertAudienceParams), not here; see that
  // method for the exact shape each audience type expects.
  audienceParams: z.record(z.unknown()).optional(),
  scheduledAt: z.string().trim().min(1).optional(),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = createCampaignSchema.omit({ promotionId: true }).partial();
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const listCampaignsQuerySchema = z
  .object({
    status: z.enum(CAMPAIGN_STATUSES).optional(),
    promotionId: z.string().trim().min(1).optional(),
  })
  .merge(paginationQuerySchema);
export type ListCampaignsQueryInput = z.infer<typeof listCampaignsQuerySchema>;

// --- Customer-facing (checkout/claim) ---------------------------------------

export const validatePromoCodeSchema = z.object({
  promoCode: z.string().trim().toUpperCase().min(1).max(40),
  orderType: z.enum(['TAKEOUT', 'DELIVERY']),
  subtotal: positiveMoneyString,
  menuItemIds: z.array(z.string().trim().min(1)).default([]),
});
export type ValidatePromoCodeInput = z.infer<typeof validatePromoCodeSchema>;
