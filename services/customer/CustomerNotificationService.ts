import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError } from '@/lib/utils/api-error';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import type {
  ListNotificationsQueryInput,
  RegisterPushTokenInput,
  UpdateNotificationPreferencesInput,
} from '@/lib/validation/customer-notification';

/**
 * CAPP Phase 9 — spec § 27 "Notification Center" and § 26 "Promotion
 * notification preferences," the customer app's own half of this phase
 * (the restaurant/campaign-authoring half lives in
 * `PromotionCampaignService`/`NotificationDispatchService`). Every method
 * requires a signed-in diner — a notification center is inherently a
 * per-account inbox, same boundary `CustomerPromotionService.listMine`
 * already draws for "my offers."
 */
export class CustomerNotificationService {
  static async list(publicCode: string, customerAccountId: string, query: ListNotificationsQueryInput) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const [notifications, unreadCount] = await Promise.all([
      prisma.customerNotification.findMany({
        where: {
          organizationId,
          customerAccountId,
          category: query.category,
          isRead: query.unreadOnly ? false : undefined,
        },
        orderBy: { createdAt: 'desc' },
        take: query.take,
        skip: query.skip,
      }),
      prisma.customerNotification.count({ where: { organizationId, customerAccountId, isRead: false } }),
    ]);
    return { notifications, unreadCount };
  }

  static async markRead(publicCode: string, customerAccountId: string, notificationId: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const notification = await prisma.customerNotification.findFirst({ where: { id: notificationId, organizationId, customerAccountId } });
    if (!notification) throw new NotFoundError('Notification');
    if (notification.isRead) return notification;
    const now = new Date();
    const [updated] = await prisma.$transaction([
      prisma.customerNotification.update({ where: { id: notificationId }, data: { isRead: true, readAt: now } }),
      // CAPP Phase 11 — spec § 55 "Open rate." IN_APP is the one channel
      // this build can ever genuinely mark opened (see
      // `NotificationDelivery`'s own header on why PUSH/EMAIL/SMS can't —
      // no provider webhook exists to confirm it for those) — a diner
      // actually tapping into a notification-center entry IS a real "this
      // was opened" signal, not a guess. `openedAt: null` guards against
      // overwriting an earlier open if this were ever called twice.
      this.markInAppDeliveryOpened(notificationId, now),
    ]);
    return updated;
  }

  /** Spec § 27 "Mark all as read." */
  static async markAllRead(publicCode: string, customerAccountId: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const now = new Date();
    // Order matters: the delivery-open update runs first, while its
    // `isRead: false` filter can still tell "was unread" apart from "was
    // already read" — flipping `customerNotification.isRead` to true first
    // would make every row in this batch match `isRead: false` as false,
    // silently no-op-ing the open-tracking update for the whole batch.
    const [, result] = await prisma.$transaction([
      prisma.notificationDelivery.updateMany({
        where: { channel: 'IN_APP', openedAt: null, customerNotification: { organizationId, customerAccountId, isRead: false } },
        data: { openedAt: now },
      }),
      prisma.customerNotification.updateMany({
        where: { organizationId, customerAccountId, isRead: false },
        data: { isRead: true, readAt: now },
      }),
    ]);
    return { updated: result.count };
  }

  private static markInAppDeliveryOpened(notificationId: string, openedAt: Date) {
    return prisma.notificationDelivery.updateMany({
      where: { customerNotificationId: notificationId, channel: 'IN_APP', openedAt: null },
      data: { openedAt },
    });
  }

  /** Spec § 27 "Delete where appropriate" — a diner's own notification, their call; no restriction beyond ownership. */
  static async remove(publicCode: string, customerAccountId: string, notificationId: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const notification = await prisma.customerNotification.findFirst({ where: { id: notificationId, organizationId, customerAccountId } });
    if (!notification) throw new NotFoundError('Notification');
    await prisma.customerNotification.delete({ where: { id: notificationId } });
    return { success: true as const };
  }

  /** Spec § 26 — always returns a row (the schema's own column defaults), even before the diner has ever touched their settings. */
  static async getPreferences(customerAccountId: string) {
    const existing = await prisma.customerNotificationPreference.findUnique({ where: { customerAccountId } });
    if (existing) return existing;
    return prisma.customerNotificationPreference.create({ data: { customerAccountId } });
  }

  static async updatePreferences(customerAccountId: string, input: UpdateNotificationPreferencesInput) {
    return prisma.customerNotificationPreference.upsert({
      where: { customerAccountId },
      create: { customerAccountId, ...input },
      update: input,
    });
  }

  /**
   * Spec § 47's device-registration flow lib/notifications/PushProvider.ts
   * anticipated but this codebase never had until now. `token` is globally
   * unique (one physical device slot) — re-registering the same token
   * (app reinstall, or a different customer signing in on a shared/reused
   * device) reassigns it rather than erroring, since a stale token
   * pointing at a previous account would silently misdeliver pushes
   * otherwise.
   */
  static async registerPushToken(customerAccountId: string, input: RegisterPushTokenInput) {
    return prisma.customerPushToken.upsert({
      where: { token: input.token },
      create: { customerAccountId, token: input.token, platform: input.platform ?? null },
      update: { customerAccountId, platform: input.platform ?? null, lastSeenAt: new Date() },
    });
  }

  static async unregisterPushToken(customerAccountId: string, token: string) {
    const existing = await prisma.customerPushToken.findUnique({ where: { token } });
    // Not found, or owned by a different account (e.g. a stale request
    // after the token was already reassigned) — either way there is
    // nothing this account can meaningfully unregister; treat as a no-op
    // rather than leaking whether the token belongs to someone else.
    if (!existing || existing.customerAccountId !== customerAccountId) return;
    await prisma.customerPushToken.delete({ where: { token } });
  }
}
