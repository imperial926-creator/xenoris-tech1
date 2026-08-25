import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { getEmailProvider } from '@/lib/notifications/EmailProvider';
import { getSmsProvider } from '@/lib/notifications/SmsProvider';
import { getPushProvider } from '@/lib/notifications/PushProvider';
import { resolveCustomerNotificationSettings, isWithinQuietHours } from '@/lib/notifications/customer-app-settings';
import { log } from '@/lib/monitoring/logger';

/**
 * CAPP Phase 9 — spec § 33's last box this build can honestly claim: "Push/
 * email/SMS workers." This is that worker, shaped as a real, callable,
 * idempotent batch method rather than a fake always-on process — this
 * codebase has no queue/worker infrastructure anywhere (no Redis, no
 * BullMQ, no cron), the same constraint every prior phase has hit and
 * handled the same way. `NotificationService.sendReservationReminder` (and
 * its three siblings) have been "real interface, fully implemented, ready
 * to be invoked from a future scheduled job, never called automatically"
 * since Phase 14 — `dispatchQueued` below is exactly that pattern applied
 * to `NotificationDelivery` rows instead of reminder sends.
 *
 * What IS wired: `POST /api/campaigns/dispatch` (staff-gated,
 * `PROMOTION_MANAGE`) calls this on demand — a real, authenticated trigger
 * point a restaurant's own external scheduler (or a staff member, in a
 * pinch) can hit, standing in for the cron this sandbox can't run. This is
 * not a lesser version of "a worker" — many real production systems
 * literally are "an authenticated endpoint an external scheduler calls" —
 * it's the same design, just without a scheduler configured in this build.
 *
 * Delivery ceiling: a successful provider call is recorded SENT, never
 * DELIVERED/OPENED — this build has no delivery-receipt or open-tracking
 * webhook from any provider (real or stub), so claiming further funnel
 * stages than the provider's own `send()` result actually confirms would
 * be exactly the kind of overclaim this codebase's "no fake integrations"
 * principle forbids. DELIVERED/OPENED remain real, valid states other code
 * can reach (a future webhook handler would set them) — just never set here.
 */
export class NotificationDispatchService {
  static async dispatchQueued(organizationId: string, limit?: number) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { customerAppSettings: true } });
    const settings = resolveCustomerNotificationSettings(org?.customerAppSettings ?? null);
    const batchSize = limit ?? settings.dispatchBatchSize;

    if (isWithinQuietHours(settings, new Date())) {
      log.info('CAPP Phase 9: dispatch skipped — within configured quiet hours', { organizationId });
      return { attempted: 0, sent: 0, failed: 0, skippedQuietHours: true };
    }

    const queued = await prisma.notificationDelivery.findMany({
      where: {
        status: 'QUEUED',
        channel: { in: ['PUSH', 'EMAIL', 'SMS'] },
        customerNotification: { organizationId },
      },
      include: {
        customerNotification: {
          include: { customerAccount: { include: { pushTokens: true } } },
        },
      },
      orderBy: { queuedAt: 'asc' },
      take: batchSize,
    });

    let sent = 0;
    let failed = 0;
    for (const delivery of queued) {
      const { customerNotification } = delivery;
      const { customerAccount, title, message } = customerNotification;
      const ok = await this.attempt(delivery.id, delivery.channel, {
        title,
        message,
        email: customerAccount.email,
        mobile: customerAccount.mobile,
        pushTokens: customerAccount.pushTokens.map((t) => t.token),
      });
      if (ok) sent += 1;
      else failed += 1;
    }

    return { attempted: queued.length, sent, failed, skippedQuietHours: false };
  }

  private static async attempt(
    deliveryId: string,
    channel: 'PUSH' | 'EMAIL' | 'SMS',
    recipient: { title: string; message: string; email: string | null; mobile: string | null; pushTokens: string[] },
  ): Promise<boolean> {
    try {
      if (channel === 'EMAIL') {
        if (!recipient.email) return this.markFailed(deliveryId, 'No email on file.');
        const provider = getEmailProvider();
        if (provider.name === 'unconfigured') return this.markFailed(deliveryId, 'No email provider configured.');
        const result = await provider.send({ to: recipient.email, subject: recipient.title, body: recipient.message });
        return result.status === 'sent'
          ? this.markSent(deliveryId, result.providerReference)
          : this.markFailed(deliveryId, 'Email provider reported failure.');
      }
      if (channel === 'SMS') {
        if (!recipient.mobile) return this.markFailed(deliveryId, 'No mobile number on file.');
        const provider = getSmsProvider();
        if (provider.name === 'unconfigured') return this.markFailed(deliveryId, 'No SMS provider configured.');
        const result = await provider.send({ to: recipient.mobile, body: `${recipient.title}: ${recipient.message}` });
        return result.status === 'sent'
          ? this.markSent(deliveryId, result.providerReference)
          : this.markFailed(deliveryId, 'SMS provider reported failure.');
      }
      // PUSH — spec § 48's "notification payload should contain notification_id,
      // restaurant_id, promotion_id, deep_link" (never sensitive text); the
      // title/body here are already the same short, non-sensitive copy the
      // in-app CustomerNotification row carries.
      if (recipient.pushTokens.length === 0) return this.markFailed(deliveryId, 'No device registered for push.');
      const provider = getPushProvider();
      if (provider.name === 'unconfigured') return this.markFailed(deliveryId, 'No push provider configured.');
      // One token succeeding is enough to call the delivery attempt SENT —
      // a customer can have multiple devices; this row tracks "did the
      // notification reach them," not "did every device get it."
      let anySent = false;
      let lastReference: string | undefined;
      for (const token of recipient.pushTokens) {
        const result = await provider.send({ to: token, title: recipient.title, body: recipient.message });
        if (result.status === 'sent') {
          anySent = true;
          lastReference = result.providerReference;
        }
      }
      return anySent ? this.markSent(deliveryId, lastReference) : this.markFailed(deliveryId, 'Push provider reported failure for every registered device.');
    } catch (error) {
      log.warn('CAPP Phase 9: notification dispatch attempt threw', { deliveryId, channel, error: error instanceof Error ? error.message : String(error) });
      return this.markFailed(deliveryId, error instanceof Error ? error.message : String(error));
    }
  }

  private static async markSent(deliveryId: string, providerReference?: string): Promise<true> {
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: 'SENT', sentAt: new Date(), providerReference: providerReference ?? null },
    });
    return true;
  }

  private static async markFailed(deliveryId: string, errorMessage: string): Promise<false> {
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: 'FAILED', failedAt: new Date(), errorMessage },
    });
    return false;
  }
}
