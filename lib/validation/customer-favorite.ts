import { z } from 'zod';
import { paginationQuerySchema } from '@/lib/validation/pagination';

/**
 * CAPP Phase 10 — spec § 38 "Favorite items" / "Favorite orders." Two
 * distinct request bodies (an item id or an order id), matching
 * CustomerFavorite's own XOR-column schema — never both, never neither, so
 * `.strict()`-style ambiguity is caught here rather than left for the
 * service layer to guess.
 */
export const addFavoriteItemSchema = z.object({
  menuItemId: z.string().trim().min(1),
});
export type AddFavoriteItemInput = z.infer<typeof addFavoriteItemSchema>;

export const addFavoriteOrderSchema = z.object({
  orderId: z.string().trim().min(1),
});
export type AddFavoriteOrderInput = z.infer<typeof addFavoriteOrderSchema>;

// CAPP Phase 12 hardening (performance audit): both favorites lists were
// unbounded `findMany`s — a diner with years of favorited items/orders got
// everything back in one response, and `listFavoriteOrders` in particular
// carries the full `ORDER_INCLUDE` payload (items, modifiers, payments,
// delivery) per row. Same bounded-`take` shape `CustomerOrderService.list`
// already uses; defaults apply even to mobile clients that don't send
// `take`/`skip` yet, so this bounds the endpoint today without requiring a
// simultaneous mobile change.
export const listFavoritesQuerySchema = paginationQuerySchema;
export type ListFavoritesQueryInput = z.infer<typeof listFavoritesQuerySchema>;
