import { z } from 'zod';

// Decimal-as-string in, Decimal out via Prisma. Zod validates the *shape*
// (a non-negative number with at most 2 decimal places); Prisma/Postgres own
// the actual storage precision. Never parseFloat this for money math — pass
// the validated string straight to Prisma's Decimal field.
const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Must be a non-negative amount with up to 2 decimal places.');

export const createMenuCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  displayOrder: z.number().int().min(0).default(0),
});
export type CreateMenuCategoryInput = z.infer<typeof createMenuCategorySchema>;

export const updateMenuCategorySchema = createMenuCategorySchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateMenuCategoryInput = z.infer<typeof updateMenuCategorySchema>;

export const createMenuItemSchema = z.object({
  categoryId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  price: money,
  cost: money.optional(),
  preparationTimeMinutes: z.number().int().min(0).max(600).optional(),
  available: z.boolean().default(true),
  imageUrl: z.string().trim().url().optional(),
  taxCategory: z.string().trim().max(40).default('STANDARD'),
});
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;

export const updateMenuItemSchema = createMenuItemSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;

export const createMenuItemVariantSchema = z.object({
  name: z.string().trim().min(1).max(80),
  price: money,
  cost: money.optional(),
  displayOrder: z.number().int().min(0).default(0),
});
export type CreateMenuItemVariantInput = z.infer<typeof createMenuItemVariantSchema>;

export const createModifierGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    selectionType: z.enum(['SINGLE', 'MULTIPLE']).default('SINGLE'),
    required: z.boolean().default(false),
    minSelect: z.number().int().min(0).default(0),
    maxSelect: z.number().int().min(1).default(1),
  })
  .refine((v) => v.maxSelect >= v.minSelect, {
    message: 'maxSelect must be greater than or equal to minSelect.',
    path: ['maxSelect'],
  })
  .refine((v) => v.selectionType !== 'SINGLE' || v.maxSelect === 1, {
    message: 'A SINGLE-selection group must have maxSelect = 1.',
    path: ['maxSelect'],
  });
export type CreateModifierGroupInput = z.infer<typeof createModifierGroupSchema>;

export const createModifierSchema = z.object({
  name: z.string().trim().min(1).max(80),
  priceDelta: money.default('0'),
  displayOrder: z.number().int().min(0).default(0),
});
export type CreateModifierInput = z.infer<typeof createModifierSchema>;

export const linkModifierGroupSchema = z.object({
  modifierGroupId: z.string().trim().min(1),
});
export type LinkModifierGroupInput = z.infer<typeof linkModifierGroupSchema>;
