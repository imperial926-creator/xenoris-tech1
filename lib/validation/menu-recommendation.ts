import { z } from 'zod';

// Same decimal-as-string pattern every other validation file in this
// codebase uses for money fields.
const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Must be a non-negative amount with up to 2 decimal places.');

/**
 * CAPP Phase 10 — spec § 39 "Upselling": "Restaurant controls the
 * recommendation." Staff-authored pairing (this item -> a suggested one),
 * created via `POST /api/menu/items/[id]/recommendations`.
 */
export const createMenuItemRecommendationSchema = z.object({
  recommendedMenuItemId: z.string().trim().min(1),
  label: z.string().trim().max(150).optional(),
  bundlePrice: moneyString.optional(),
  displayOrder: z.number().int().min(0).max(1000).default(0),
});
export type CreateMenuItemRecommendationInput = z.infer<typeof createMenuItemRecommendationSchema>;
