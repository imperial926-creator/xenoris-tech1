import { z } from 'zod';

export const openingHoursSchema = z.record(
  z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  z.object({ open: z.string(), close: z.string(), closed: z.boolean().default(false) }),
);

export const createBranchSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  timezone: z.string().trim().min(1).default('Asia/Manila'),
  openingHours: openingHoursSchema.optional(),
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = createBranchSchema.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE', 'TEMPORARILY_CLOSED']).optional(),
});
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
