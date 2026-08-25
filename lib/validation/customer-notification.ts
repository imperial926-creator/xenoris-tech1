import { z } from 'zod';
import { paginationQuerySchema } from '@/lib/validation/pagination';

/**
 * CAPP Phase 9 — the customer app's own notification-center/preferences/
 * push-token schemas. Named `customer-notification` (not `notification`)
 * to stay distinct from the base platform's own Phase 14
 * `lib/validation/notification.ts` (staff-side, branch-scoped
 * transactional-notification history) — same disambiguation
 * `customer-order.ts` already draws against `order.ts`.
 */

export const CUSTOMER_NOTIFICATION_CATEGORIES = ['ORDER', 'RESERVATION', 'PAYMENT', 'PROMOTION', 'LOYALTY', 'CATERING', 'SYSTEM'] as const;

export const listNotificationsQuerySchema = z
  .object({
    category: z.enum(CUSTOMER_NOTIFICATION_CATEGORIES).optional(),
    unreadOnly: z.coerce.boolean().optional(),
  })
  .merge(paginationQuerySchema);
export type ListNotificationsQueryInput = z.infer<typeof listNotificationsQuerySchema>;

// Spec § 26 — every field optional so a PATCH can update just the ones the
// diner actually touched on the settings screen; `getPreferences`/
// `updatePreferences` (CustomerNotificationService) fill in the rest from
// the schema's own column defaults on first write.
export const updateNotificationPreferencesSchema = z.object({
  allowPromotional: z.boolean().optional(),
  allowOrderUpdates: z.boolean().optional(),
  allowReservationUpdates: z.boolean().optional(),
  allowLoyalty: z.boolean().optional(),
  allowCatering: z.boolean().optional(),
  emailPromotions: z.boolean().optional(),
  smsPromotions: z.boolean().optional(),
  pushPromotions: z.boolean().optional(),
});
export type UpdateNotificationPreferencesInput = z.infer<typeof updateNotificationPreferencesSchema>;

// Spec § 47 device registration. `token` is opaque (an Expo/APNs/FCM push
// token, whichever a future mobile call site produces — see
// architecture.md § 18 for why no call site exists yet), `platform` is
// informational only, never branched on server-side.
export const registerPushTokenSchema = z.object({
  token: z.string().trim().min(1).max(500),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;

// No corresponding "unregister" schema — DELETE /api/v1/customer/push-tokens/[token]
// takes the token as a path param (encodeURIComponent'd, same convention
// every other id-in-path route already uses), not a request body.
