import { z } from 'zod';

export const DELIVERY_STATUSES = ['UNASSIGNED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'FAILED', 'CANCELLED'] as const;

// Decimal-as-string in, Decimal out via Prisma — same pattern as every other
// validation file in this codebase (lib/validation/menu.ts, order.ts). Not
// shared into a common util deliberately; see those files' own comments.
const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Must be a non-negative amount with up to 2 decimal places.');

export const createDeliveryZoneSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  deliveryFee: moneyString.default('0.00'),
});
export type CreateDeliveryZoneInput = z.infer<typeof createDeliveryZoneSchema>;

export const updateDeliveryZoneSchema = createDeliveryZoneSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateDeliveryZoneInput = z.infer<typeof updateDeliveryZoneSchema>;

export const createDriverSchema = z.object({
  userId: z.string().trim().min(1),
  vehicleType: z.string().trim().max(80).optional(),
  vehiclePlate: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(30).optional(),
});
export type CreateDriverInput = z.infer<typeof createDriverSchema>;

export const updateDriverSchema = createDriverSchema.partial().omit({ userId: true }).extend({
  active: z.boolean().optional(),
});
export type UpdateDriverInput = z.infer<typeof updateDriverSchema>;

export const assignDriverSchema = z.object({
  driverId: z.string().trim().min(1),
  note: z.string().trim().max(500).optional(),
});
export type AssignDriverInput = z.infer<typeof assignDriverSchema>;

export const updateDeliveryStatusSchema = z.object({
  status: z.enum(DELIVERY_STATUSES),
  note: z.string().trim().max(500).optional(),
  // Only meaningful when status === 'DELIVERED' — a staff/driver-entered
  // attestation, not a photo (see schema.prisma's Phase 6 comment #5).
  proofOfDeliveryNote: z.string().trim().max(500).optional(),
  recipientName: z.string().trim().max(150).optional(),
});
export type UpdateDeliveryStatusInput = z.infer<typeof updateDeliveryStatusSchema>;

export const listDeliveriesQuerySchema = z.object({
  status: z.enum(DELIVERY_STATUSES).optional(),
});
export type ListDeliveriesQueryInput = z.infer<typeof listDeliveriesQuerySchema>;
