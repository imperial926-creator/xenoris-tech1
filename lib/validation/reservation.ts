import { z } from 'zod';

export const RESERVATION_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'SEATED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;

export const DEPOSIT_STATUSES = ['NONE', 'PENDING', 'PAID', 'REFUNDED'] as const;

// Reservation slots default to 90 minutes if the caller doesn't specify a
// duration — long enough for a typical sit-down meal, short enough that back
// -to-back bookings on the same table are still realistic. Bounded to a
// sane range (30 min - 8 hours) rather than left unbounded.
const DURATION_MINUTES = z.number().int().min(30).max(480).default(90);

export const availabilityQuerySchema = z.object({
  startAt: z.string().datetime({ offset: true }).or(z.string().min(1)),
  durationMinutes: z.coerce.number().int().min(30).max(480).default(90),
  guestCount: z.coerce.number().int().min(1).max(500).default(2),
});
export type AvailabilityQueryInput = z.infer<typeof availabilityQuerySchema>;

export const createReservationSchema = z
  .object({
    tableIds: z.array(z.string().trim().min(1)).min(1, 'At least one table must be assigned.'),
    startAt: z.string().min(1),
    durationMinutes: DURATION_MINUTES,
    guestCount: z.number().int().min(1).max(500),
    customerUserId: z.string().trim().min(1).optional(),
    guestName: z.string().trim().min(1).max(150),
    guestEmail: z.string().trim().toLowerCase().email().optional(),
    guestPhone: z.string().trim().max(30).optional(),
    specialRequests: z.string().trim().max(1000).optional(),
    occasion: z.string().trim().max(120).optional(),
    depositRequired: z.boolean().default(false),
    depositAmount: z
      .union([z.string(), z.number()])
      .transform((v) => String(v))
      .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Deposit amount must be a valid monetary value.')
      .optional(),
    depositNote: z.string().trim().max(500).optional(),
  })
  .refine((v) => !v.depositRequired || v.depositAmount !== undefined, {
    message: 'depositAmount is required when depositRequired is true.',
    path: ['depositAmount'],
  });
export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const updateReservationStatusSchema = z.object({
  status: z.enum(RESERVATION_STATUSES),
  note: z.string().trim().max(500).optional(),
  cancellationReason: z.string().trim().max(500).optional(),
});
export type UpdateReservationStatusInput = z.infer<typeof updateReservationStatusSchema>;

export const recordDepositSchema = z.object({
  depositStatus: z.enum(DEPOSIT_STATUSES),
  depositAmount: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Deposit amount must be a valid monetary value.')
    .optional(),
  depositNote: z.string().trim().max(500).optional(),
});
export type RecordDepositInput = z.infer<typeof recordDepositSchema>;

export const listReservationsQuerySchema = z.object({
  status: z.enum(RESERVATION_STATUSES).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type ListReservationsQueryInput = z.infer<typeof listReservationsQuerySchema>;
