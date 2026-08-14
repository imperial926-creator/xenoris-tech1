import { z } from 'zod';

export const ORDER_TYPES = ['DINE_IN', 'TAKEOUT', 'DELIVERY'] as const;
export const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'] as const;
export const ORDER_PAYMENT_METHODS = ['CASH', 'CARD', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'] as const;
export const ORDER_PAYMENT_STATUSES = ['PENDING', 'COMPLETED', 'REFUNDED'] as const;

const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Must be a valid monetary value.');

export const orderItemInputSchema = z.object({
  menuItemId: z.string().trim().min(1),
  menuItemVariantId: z.string().trim().min(1).optional(),
  quantity: z.number().int().min(1).max(50),
  modifierIds: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().trim().max(300).optional(),
});
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

export const createOrderSchema = z
  .object({
    type: z.enum(ORDER_TYPES),
    tableId: z.string().trim().min(1).optional(),
    reservationId: z.string().trim().min(1).optional(),
    deliveryAddress: z.string().trim().min(1).max(400).optional(),
    customerUserId: z.string().trim().min(1).optional(),
    guestName: z.string().trim().max(150).optional(),
    guestEmail: z.string().trim().toLowerCase().email().optional(),
    guestPhone: z.string().trim().max(30).optional(),
    notes: z.string().trim().max(500).optional(),
    discountAmount: moneyString.default('0.00'),
    // Optional "have this ready by" time for the kitchen board (Phase 5).
    // Loose string, parsed/validated as a real Date in OrderService — same
    // pattern as ReservationService.resolveWindow's startAt. Omit for
    // "as soon as possible" (the default for most walk-in orders).
    requiredAt: z.string().trim().min(1).optional(),
    items: z.array(orderItemInputSchema).min(1, 'An order needs at least one item.'),
  })
  .refine((v) => v.type !== 'DELIVERY' || !!v.deliveryAddress, {
    message: 'deliveryAddress is required for DELIVERY orders.',
    path: ['deliveryAddress'],
  });
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(500).optional(),
  cancellationReason: z.string().trim().max(500).optional(),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

export const recordOrderPaymentSchema = z.object({
  method: z.enum(ORDER_PAYMENT_METHODS),
  amount: moneyString,
  status: z.enum(ORDER_PAYMENT_STATUSES).default('COMPLETED'),
  note: z.string().trim().max(500).optional(),
});
export type RecordOrderPaymentInput = z.infer<typeof recordOrderPaymentSchema>;

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

export const listOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  type: z.enum(ORDER_TYPES).optional(),
});
export type ListOrdersQueryInput = z.infer<typeof listOrdersQuerySchema>;
