import { z } from 'zod';
import { orderItemInputSchema, ORDER_PAYMENT_METHODS } from '@/lib/validation/order';
import { paginationQuerySchema } from '@/lib/validation/pagination';

/**
 * CAPP Phase 4 — customer-facing take-out ordering, spec § 11: "Selects
 * food. Adds modifiers. Adds special instructions. Selects pickup time.
 * Pays. Receives confirmation." Deliberately NOT the staff
 * `createOrderSchema` (lib/validation/order.ts): there is no `tableId`,
 * `reservationId`, or `customerUserId`/`customerId` field here — dine-in
 * ordering from the app isn't in the spec's 12-phase sequence at all, and
 * contact identity is sourced server-side from the authenticated
 * CustomerAccount/Customer profile, never taken as free text from the
 * request body (a diner cannot book/order "as" someone else).
 *
 * CAPP Phase 5 extends this to `type: 'DELIVERY'` (spec § 12), reusing
 * `orderItemInputSchema`/`paymentMethod` as-is and adding delivery-only
 * fields. See CustomerOrderService.createOrder's JSDoc for why there is a
 * `deliveryZoneId` (the diner picks a zone — there is no address-to-zone
 * auto-matching anywhere in this codebase) and a `deliveryAddressId` OR
 * freeform `deliveryAddress` (a saved address from CustomerAddressService,
 * or one-off free text — same "saved contact OR one-off text" leniency the
 * staff schema already gives `deliveryAddress`).
 */

export const CUSTOMER_ORDER_TYPES = ['TAKEOUT', 'DELIVERY'] as const;
export type CustomerOrderType = (typeof CUSTOMER_ORDER_TYPES)[number];

export const customerCreateOrderSchema = z
  .object({
    items: z.array(orderItemInputSchema).min(1, 'Add at least one item to your order.'),
    type: z.enum(CUSTOMER_ORDER_TYPES).default('TAKEOUT'),
    // spec § 11 "Selects pickup time" — required for TAKEOUT only, unlike
    // the staff schema's `requiredAt` (optional there because staff can also
    // be recording a walk-in order with no scheduled time at all). Not used
    // for DELIVERY — see CustomerOrderService's JSDoc for why a delivery
    // order has no diner-chosen time (there's no ETA estimation anywhere in
    // this codebase — DeliveryOrder.estimatedDeliveryAt is a schema column
    // no code path ever sets — so promising a delivery *window* up front
    // would be a claim this platform cannot honestly back).
    pickupTime: z.string().trim().min(1).optional(),
    // DELIVERY only. The diner picks an active zone from
    // GET /delivery-zones — see DeliveryZoneService.listActive's JSDoc for
    // why this is a picker, not a geocoded lookup.
    deliveryZoneId: z.string().trim().min(1).optional(),
    // DELIVERY only, one of these two. `deliveryAddressId` references a
    // saved CustomerAddress (CustomerAddressService); `deliveryAddress` is
    // free text for a one-off delivery the diner doesn't want to save.
    deliveryAddressId: z.string().trim().min(1).optional(),
    deliveryAddress: z.string().trim().min(1).max(400).optional(),
    // The customer's stated intent, not a processed payment — see
    // CustomerOrderService's header comment for why this can never result in
    // an OrderPayment row marked COMPLETED. "Pay at pickup/delivery" is
    // CASH; the other methods represent "I intend to pay this way", pending
    // staff confirmation/settlement.
    paymentMethod: z.enum(ORDER_PAYMENT_METHODS),
    notes: z.string().trim().max(500).optional(),
    // CAPP Phase 8 — an optional promo code entered at checkout. Validated
    // and priced server-side (PromotionService), never trusted directly —
    // see OrderService.createOrder's own promo-handling comment.
    promoCode: z.string().trim().toUpperCase().min(1).max(40).optional(),
  })
  .refine((v) => v.type !== 'TAKEOUT' || !!v.pickupTime, {
    message: 'pickupTime is required for take-out orders.',
    path: ['pickupTime'],
  })
  .refine((v) => v.type !== 'DELIVERY' || !!v.deliveryZoneId, {
    message: 'deliveryZoneId is required for delivery orders — pick a delivery zone.',
    path: ['deliveryZoneId'],
  })
  .refine((v) => v.type !== 'DELIVERY' || !!v.deliveryAddressId || !!v.deliveryAddress, {
    message: 'A delivery address is required for delivery orders — pick a saved address or enter one.',
    path: ['deliveryAddress'],
  });
export type CustomerCreateOrderInput = z.infer<typeof customerCreateOrderSchema>;

export const customerListOrdersQuerySchema = z
  .object({
    openOnly: z.coerce.boolean().optional(),
    // CAPP Phase 5: optional filter so the mobile app's history view can
    // separate "Take-out" from "Delivery" tabs. Omit to see both — the
    // pre-Phase-5 behavior (hard-coded to TAKEOUT only) is gone now that a
    // diner can place either type through this same endpoint.
    type: z.enum(CUSTOMER_ORDER_TYPES).optional(),
  })
  .merge(paginationQuerySchema);
export type CustomerListOrdersQueryInput = z.infer<typeof customerListOrdersQuerySchema>;
