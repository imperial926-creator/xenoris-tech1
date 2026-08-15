import { z } from 'zod';

export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;

export const createCustomerSchema = z.object({
  // Optional link to an existing User account — see the "Phase 8 — CRM"
  // comment block in schema.prisma (#1). Most customers won't have one.
  userId: z.string().trim().min(1).optional(),
  firstName: z.string().trim().min(1).max(150),
  lastName: z.string().trim().max(150).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(30).optional(),
  // Loose string in, parsed/validated as a real Date in CustomerService —
  // same pattern as CateringInquiry's eventDate.
  dateOfBirth: z.string().trim().min(1).optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema.omit({ userId: true }).partial().extend({
  status: z.enum(CUSTOMER_STATUSES).optional(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const createCustomerAddressSchema = z.object({
  label: z.string().trim().max(60).optional(),
  line1: z.string().trim().min(1).max(300),
  line2: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  province: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().min(1).max(2).default('PH'),
  isDefault: z.boolean().default(false),
});
export type CreateCustomerAddressInput = z.infer<typeof createCustomerAddressSchema>;

export const updateCustomerAddressSchema = createCustomerAddressSchema.partial();
export type UpdateCustomerAddressInput = z.infer<typeof updateCustomerAddressSchema>;

export const setCustomerPreferenceSchema = z.object({
  key: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(500),
});
export type SetCustomerPreferenceInput = z.infer<typeof setCustomerPreferenceSchema>;

export const createCustomerNoteSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});
export type CreateCustomerNoteInput = z.infer<typeof createCustomerNoteSchema>;

export const createCustomerTagSchema = z.object({
  tag: z.string().trim().min(1).max(60),
});
export type CreateCustomerTagInput = z.infer<typeof createCustomerTagSchema>;

// No customerId-or-orderId-or-... refinement forcing at least one link —
// same leniency Order/Reservation already give guest contact fields. A
// review can stand alone (a walk-in comment card with no linked record).
export const createCustomerReviewSchema = z.object({
  branchId: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  orderId: z.string().trim().min(1).optional(),
  reservationId: z.string().trim().min(1).optional(),
  cateringEventId: z.string().trim().min(1).optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
});
export type CreateCustomerReviewInput = z.infer<typeof createCustomerReviewSchema>;

export const listCustomersQuerySchema = z.object({
  status: z.enum(CUSTOMER_STATUSES).optional(),
  search: z.string().trim().min(1).max(150).optional(),
});
export type ListCustomersQueryInput = z.infer<typeof listCustomersQuerySchema>;
