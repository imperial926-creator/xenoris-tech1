import { z } from 'zod';
import { paginationQuerySchema } from '@/lib/validation/pagination';

export const CATERING_INQUIRY_STATUSES = ['NEW', 'QUOTED', 'CONVERTED', 'CANCELLED'] as const;
export const CATERING_QUOTE_STATUSES = ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'] as const;
export const CATERING_EVENT_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const CATERING_PAYMENT_TYPES = ['DEPOSIT', 'BALANCE'] as const;
// Reused from Order's payment model deliberately, not redeclared — see
// schema.prisma's Phase 7 comment block (#3).
export const CATERING_PAYMENT_METHODS = ['CASH', 'CARD', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'] as const;
export const CATERING_PAYMENT_STATUSES = ['PENDING', 'COMPLETED', 'REFUNDED'] as const;

// Decimal-as-string in, Decimal out via Prisma — same pattern as every other
// validation file in this codebase.
const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Must be a non-negative amount with up to 2 decimal places.');

// Phase 15 hardening: recordCateringPaymentSchema.amount used the bare
// moneyString above, which accepts "0" — a $0 payment record is
// meaningless and was silently accepted instead of rejected as a likely
// input mistake. Same fix as lib/validation/order.ts's positiveMoneyString.
const positiveMoneyString = moneyString.refine((v) => Number(v) > 0, 'Must be a positive amount.');

export const createCateringPackageSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  pricePerGuest: moneyString,
  minGuests: z.number().int().min(1).max(10000).optional(),
  maxGuests: z.number().int().min(1).max(10000).optional(),
});
export type CreateCateringPackageInput = z.infer<typeof createCateringPackageSchema>;

export const updateCateringPackageSchema = createCateringPackageSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateCateringPackageInput = z.infer<typeof updateCateringPackageSchema>;

export const createCateringInquirySchema = z.object({
  customerUserId: z.string().trim().min(1).optional(),
  // Phase 8 — CRM. Optional link to a Customer/CRM profile — see the
  // matching comment on createOrderSchema.customerId. Propagated onto the
  // CateringEvent automatically when the quote is accepted (not itself
  // settable on the event).
  customerId: z.string().trim().min(1).optional(),
  guestName: z.string().trim().min(1).max(150).optional(),
  guestEmail: z.string().trim().toLowerCase().email().optional(),
  guestPhone: z.string().trim().max(30).optional(),
  eventType: z.string().trim().min(1).max(120),
  eventDate: z.string().trim().min(1),
  location: z.string().trim().min(1).max(300),
  guestCount: z.number().int().min(1).max(10000),
  packageId: z.string().trim().min(1).optional(),
  menuRequirements: z.string().trim().max(2000).optional(),
  equipmentRequests: z.string().trim().max(1000).optional(),
  staffRequests: z.string().trim().max(1000).optional(),
  setupRequests: z.string().trim().max(1000).optional(),
  deliveryRequested: z.boolean().default(false),
  deliveryAddress: z.string().trim().max(400).optional(),
  specialRequests: z.string().trim().max(1000).optional(),
});
export type CreateCateringInquiryInput = z.infer<typeof createCateringInquirySchema>;

export const updateCateringInquirySchema = createCateringInquirySchema.partial().extend({
  status: z.enum(CATERING_INQUIRY_STATUSES).optional(),
});
export type UpdateCateringInquiryInput = z.infer<typeof updateCateringInquirySchema>;

export const cateringQuoteItemInputSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().int().min(1).max(10000),
  unitPrice: moneyString,
});
export type CateringQuoteItemInput = z.infer<typeof cateringQuoteItemInputSchema>;

export const createCateringQuoteSchema = z.object({
  inquiryId: z.string().trim().min(1),
  packageId: z.string().trim().min(1).optional(),
  guestCount: z.number().int().min(1).max(10000),
  items: z.array(cateringQuoteItemInputSchema).default([]),
  // Flat negotiated amounts, not itemized — see schema.prisma's Phase 7
  // comment block (#1) for why. foodTotal/taxTotal/total are always
  // server-computed, never accepted from the client.
  staffingTotal: moneyString.default('0.00'),
  equipmentTotal: moneyString.default('0.00'),
  transportationTotal: moneyString.default('0.00'),
  setupTotal: moneyString.default('0.00'),
  serviceFeeTotal: moneyString.default('0.00'),
  discountTotal: moneyString.default('0.00'),
});
export type CreateCateringQuoteInput = z.infer<typeof createCateringQuoteSchema>;

// Same shape as creation — a quote can only be edited while still DRAFT
// (enforced in CateringService, not here).
export const updateCateringQuoteSchema = createCateringQuoteSchema.omit({ inquiryId: true }).partial();
export type UpdateCateringQuoteInput = z.infer<typeof updateCateringQuoteSchema>;

export const updateCateringQuoteStatusSchema = z.object({
  status: z.enum(CATERING_QUOTE_STATUSES),
  note: z.string().trim().max(500).optional(),
  rejectionReason: z.string().trim().max(500).optional(),
  cancellationReason: z.string().trim().max(500).optional(),
  // Optional — how long a SENT quote stays open before it can be marked
  // EXPIRED. Purely informational (not auto-enforced by a background job;
  // no scheduler is configured in this build), same "no fake integrations"
  // stance as the rest of this codebase.
  expiresAt: z.string().trim().min(1).optional(),
});
export type UpdateCateringQuoteStatusInput = z.infer<typeof updateCateringQuoteStatusSchema>;

export const updateCateringEventStatusSchema = z.object({
  status: z.enum(CATERING_EVENT_STATUSES),
  note: z.string().trim().max(500).optional(),
  cancellationReason: z.string().trim().max(500).optional(),
});
export type UpdateCateringEventStatusInput = z.infer<typeof updateCateringEventStatusSchema>;

export const recordCateringPaymentSchema = z.object({
  type: z.enum(CATERING_PAYMENT_TYPES),
  method: z.enum(CATERING_PAYMENT_METHODS),
  amount: positiveMoneyString,
  status: z.enum(CATERING_PAYMENT_STATUSES).default('COMPLETED'),
  note: z.string().trim().max(500).optional(),
});
export type RecordCateringPaymentInput = z.infer<typeof recordCateringPaymentSchema>;

export const listCateringInquiriesQuerySchema = z.object({
  status: z.enum(CATERING_INQUIRY_STATUSES).optional(),
}).merge(paginationQuerySchema);
export type ListCateringInquiriesQueryInput = z.infer<typeof listCateringInquiriesQuerySchema>;

export const listCateringQuotesQuerySchema = z.object({
  status: z.enum(CATERING_QUOTE_STATUSES).optional(),
  inquiryId: z.string().trim().min(1).optional(),
}).merge(paginationQuerySchema);
export type ListCateringQuotesQueryInput = z.infer<typeof listCateringQuotesQuerySchema>;

export const listCateringEventsQuerySchema = z.object({
  status: z.enum(CATERING_EVENT_STATUSES).optional(),
}).merge(paginationQuerySchema);
export type ListCateringEventsQueryInput = z.infer<typeof listCateringEventsQuerySchema>;
