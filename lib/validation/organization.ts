import { z } from 'zod';

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legalName: z.string().trim().min(2).max(160).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  currency: z.string().trim().length(3).optional(),
  timezone: z.string().trim().min(1).optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
