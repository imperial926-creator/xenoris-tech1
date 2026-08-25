import { z } from 'zod';
import { paginationQuerySchema } from '@/lib/validation/pagination';

/**
 * CAPP Phase 3 — customer-facing reservation schemas. Deliberately NOT the
 * staff `createReservationSchema` (lib/validation/reservation.ts): spec § 10
 * only asks a diner for date, time, guest count, an optional "preferred
 * seating where available" (a soft preference, not a table pick), and an
 * optional special request. There is no `tableIds` field here — table
 * assignment is the system's job (see CustomerReservationService.selectTables),
 * not the diner's, and there is no `guestName`/`guestEmail`/`guestPhone`
 * either — that contact snapshot is sourced server-side from the
 * authenticated CustomerAccount/Customer profile, never taken as free text
 * from the request body (a diner cannot book "as" someone else).
 */

const DURATION_MINUTES = z.coerce.number().int().min(30).max(480).default(90);

export const customerAvailabilityQuerySchema = z.object({
  startAt: z.string().datetime({ offset: true }).or(z.string().min(1)),
  durationMinutes: DURATION_MINUTES,
  guestCount: z.coerce.number().int().min(1).max(50).default(2),
});
export type CustomerAvailabilityQueryInput = z.infer<typeof customerAvailabilityQuerySchema>;

export const customerCreateReservationSchema = z.object({
  startAt: z.string().min(1),
  durationMinutes: z.number().int().min(30).max(480).default(90),
  guestCount: z.number().int().min(1).max(50),
  // Free text ("outdoor", "window", "booth", a section name, etc.), matched
  // loosely against TableSection.name. A soft preference per spec § 10 — a
  // request is never rejected solely because the preferred seating type has
  // no availability; it is honored when possible and honestly reported back
  // (CustomerReservationService never silently substitutes without saying
  // so — see "Do not fake reservation availability", spec's dev principles).
  seatingPreference: z.string().trim().max(120).optional(),
  specialRequests: z.string().trim().max(1000).optional(),
});
export type CustomerCreateReservationInput = z.infer<typeof customerCreateReservationSchema>;

export const customerListReservationsQuerySchema = z
  .object({
    upcomingOnly: z.coerce.boolean().optional(),
  })
  .merge(paginationQuerySchema);
export type CustomerListReservationsQueryInput = z.infer<typeof customerListReservationsQuerySchema>;
