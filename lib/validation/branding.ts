import { z } from 'zod';

// Hex colors (e.g. "#1E3A8A"), validated here — the DB column itself is a
// plain String? (see RestaurantBranding in schema.prisma). Loose but real:
// requires the leading # and 3/4/6/8 hex digits (the CSS-valid shorthand
// and alpha forms), not just "any string".
const hexColor = z
  .string()
  .trim()
  .regex(/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Must be a hex color like #1E3A8A.');

export const updateBrandingSchema = z.object({
  logoUrl: z.string().trim().url().max(2000).nullable().optional(),
  coverImageUrl: z.string().trim().url().max(2000).nullable().optional(),
  primaryColor: hexColor.nullable().optional(),
  secondaryColor: hexColor.nullable().optional(),
  accentColor: hexColor.nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  website: z.string().trim().url().max(500).nullable().optional(),
  socialLinks: z.record(z.string().trim().url().max(500)).optional(),
  reservationPolicy: z.string().trim().max(2000).nullable().optional(),
  cancellationPolicy: z.string().trim().max(2000).nullable().optional(),
  deliveryPolicy: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;
