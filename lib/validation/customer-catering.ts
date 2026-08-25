import { z } from 'zod';
import { CATERING_PAYMENT_METHODS, CATERING_PAYMENT_TYPES } from '@/lib/validation/catering';
import { paginationQuerySchema } from '@/lib/validation/pagination';

/**
 * CAPP Phase 6 — customer-facing catering, spec § 13: "BOOK CATERING ...
 * Enter: Event date, Event time, Event location, Number of guests, Event
 * type, Food preferences, Budget, Special requests. Customer submits
 * inquiry ... Customer can: Accept, Decline, Request changes, Pay deposit,
 * View balance." Deliberately NOT the staff `createCateringInquirySchema`
 * (lib/validation/catering.ts): no `customerUserId`/`customerId`/
 * `guestName`/`guestEmail`/`guestPhone` (contact identity is server-resolved
 * from the authenticated CustomerAccount/Customer profile, same rule every
 * other customer-facing schema in this codebase follows), and no
 * `packageId`/`equipmentRequests`/`staffRequests`/`setupRequests`/
 * `deliveryRequested`/`deliveryAddress` — those are staff-quoting-side
 * concerns the spec's own six-field inquiry form doesn't ask a diner for.
 * "Food preferences" maps to the existing `menuRequirements` field.
 */

export const customerCreateCateringInquirySchema = z.object({
  eventType: z.string().trim().min(1).max(120),
  // "Event date" + "Event time" combined client-side into one ISO string —
  // same pattern CustomerOrderService.parsePickupTime/
  // CustomerReservationService.createReservation's startAt already use.
  eventDate: z.string().trim().min(1),
  location: z.string().trim().min(1).max(300),
  guestCount: z.number().int().min(1).max(10000),
  menuRequirements: z.string().trim().max(2000).optional(),
  budget: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Must be a non-negative amount with up to 2 decimal places.')
    .optional(),
  specialRequests: z.string().trim().max(1000).optional(),
});
export type CustomerCreateCateringInquiryInput = z.infer<typeof customerCreateCateringInquirySchema>;

export const customerListCateringInquiriesQuerySchema = paginationQuerySchema;
export type CustomerListCateringInquiriesQueryInput = z.infer<typeof customerListCateringInquiriesQuerySchema>;

// "Accept" / "Decline" (spec § 13) — the two customer-initiated quote
// responses CateringQuoteStatus's existing ACCEPTED/REJECTED transitions
// already model exactly (see CustomerCateringService.respondToQuote's
// JSDoc for why there's no third "Request changes" status here).
export const customerQuoteResponseSchema = z
  .object({
    status: z.enum(['ACCEPTED', 'REJECTED']),
    rejectionReason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status !== 'REJECTED' || !!v.rejectionReason, {
    message: 'rejectionReason is required when declining a quote.',
    path: ['rejectionReason'],
  });
export type CustomerQuoteResponseInput = z.infer<typeof customerQuoteResponseSchema>;

// "Request changes" (spec § 13) — see CateringQuote.customerNote's schema
// comment for why this is a message, not a status transition.
export const customerQuoteChangeRequestSchema = z.object({
  note: z.string().trim().min(1).max(1000),
});
export type CustomerQuoteChangeRequestInput = z.infer<typeof customerQuoteChangeRequestSchema>;

// "Pay deposit" (spec § 13) — also accepts type: 'BALANCE' so a diner can
// pay off what's left after a deposit, using the exact same
// CateringPayment/paymentSummary machinery staff already have; always
// recorded PENDING (see CustomerCateringService.payTowardBalance's JSDoc —
// same "never claim a payment is successful until the backend has verified
// it" rule Phase 4/5 apply to Order payments).
export const customerCateringPaymentSchema = z.object({
  type: z.enum(CATERING_PAYMENT_TYPES),
  method: z.enum(CATERING_PAYMENT_METHODS),
  amount: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0, 'Must be a positive amount.'),
  note: z.string().trim().max(500).optional(),
});
export type CustomerCateringPaymentInput = z.infer<typeof customerCateringPaymentSchema>;
