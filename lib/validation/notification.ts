import { z } from 'zod';

export const NOTIFICATION_TYPES = [
  'RESERVATION_CONFIRMATION',
  'RESERVATION_REMINDER',
  'DEPOSIT_REMINDER',
  'ORDER_CONFIRMATION',
  'ORDER_STATUS',
  'DELIVERY_UPDATE',
  'CATERING_QUOTATION',
  'CATERING_REMINDER',
  'PAYMENT_REMINDER',
  'INVOICE',
  'REVIEW_REQUEST',
  'CATERING_INQUIRY_RECEIVED',
] as const;

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'PUSH'] as const;

export const NOTIFICATION_STATUSES = ['SENT', 'FAILED', 'SKIPPED_NOT_CONFIGURED', 'SKIPPED_NO_RECIPIENT'] as const;

/**
 * Notification history list filters. `take` mirrors the bounded-page-size
 * pattern used across this codebase's other list schemas (default a
 * reasonable page, cap it so a caller can't force an unbounded scan of
 * every notification ever sent).
 */
export const listNotificationsQuerySchema = z.object({
  type: z.enum(NOTIFICATION_TYPES).optional(),
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListNotificationsQueryInput = z.infer<typeof listNotificationsQuerySchema>;
