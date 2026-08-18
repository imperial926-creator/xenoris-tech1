import { z } from 'zod';

/**
 * Phase 15 hardening (master spec §64 "Pagination" / "Never load the
 * entire order/customer history into the browser unnecessarily"). A shared
 * bounded-page-size schema, spread into each domain's own list-query
 * schema rather than replacing it outright, so existing filter fields
 * (status, date range, etc.) are untouched.
 *
 * Defaults match the convention Phase 14's `listNotificationsQuerySchema`
 * already established (`take` 1-200, default 50) — extended here to every
 * other unbounded list endpoint identified in the Phase 15 performance
 * audit. `skip` is optional and only used for simple offset pagination;
 * callers with genuinely large datasets and stable sort keys can switch to
 * cursor pagination later without changing this shape's `take` half.
 */
export const paginationQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});
export type PaginationQueryInput = z.infer<typeof paginationQuerySchema>;
