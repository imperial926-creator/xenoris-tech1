import { z } from 'zod';

/**
 * CAPP Phase 11 — spec § 57 "Analytics." Deliberately narrow: `eventType` is
 * one of the six values `CustomerAnalyticsEvent` actually supports (see that
 * model's schema.prisma comment for why the rest of spec § 57's funnel list
 * is read from existing tables instead), and `menuItemId`/`promotionId` are
 * plain optional strings, not validated against the menu/promotions tables —
 * this is best-effort telemetry, not a write with referential consequences,
 * so a stale/deleted id just means that one field renders as "(deleted)" in
 * an aggregate later rather than failing the whole request.
 */
export const logAnalyticsEventSchema = z.object({
  eventType: z.enum(['APP_OPENED', 'RESTAURANT_VIEWED', 'MENU_VIEWED', 'PROMOTION_VIEWED', 'PROMOTION_CLICKED', 'REORDER_TAPPED']),
  menuItemId: z.string().trim().min(1).optional(),
  promotionId: z.string().trim().min(1).optional(),
});
export type LogAnalyticsEventInput = z.infer<typeof logAnalyticsEventSchema>;
