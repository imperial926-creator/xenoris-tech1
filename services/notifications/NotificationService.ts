import 'server-only';
import { Prisma } from '@prisma/client';
import type { NotificationChannel, NotificationStatus, NotificationType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError } from '@/lib/utils/api-error';
import { getEmailProvider } from '@/lib/notifications/EmailProvider';
import { getSmsProvider } from '@/lib/notifications/SmsProvider';
import type { ListNotificationsQueryInput } from '@/lib/validation/notification';
import { log } from '@/lib/monitoring/logger';

/**
 * Phase 14 — Notifications (master spec "PHASE 14 — NOTIFICATIONS" build
 * list: "Implement: Email, Push, SMS abstraction," and master spec §40's
 * fuller notification-type list: Reservation confirmation, Reservation
 * reminder, Deposit reminder, Order confirmation, Order status, Delivery
 * updates, Catering quotation, Catering reminder, Payment reminder,
 * Invoice, Review request).
 *
 * Design principles (see prisma/schema.prisma's "Phase 14 — Notifications"
 * comment block and lib/notifications/EmailProvider.ts's header for the
 * fuller reasoning behind each):
 *
 * 1. NEVER THROWS. Every public method here catches everything internally
 *    and always resolves. Notifications are best-effort side effects of a
 *    real business transaction (a reservation confirmed, an order placed)
 *    — a flaky email/SMS provider must never fail, delay, or roll back
 *    that transaction. Every call site in this codebase calls these
 *    methods *after* its own `prisma.$transaction(...)` has already
 *    resolved, specifically so a notification failure can't touch data
 *    that has already durably committed.
 *
 * 2. ONE ROW PER CHANNEL PER ATTEMPT. A notification that fans out to both
 *    EMAIL and SMS produces two independent `Notification` rows, not one
 *    row with two statuses — each channel's delivery outcome is
 *    independently queryable/auditable. Every attempt is logged, including
 *    both `SKIPPED_*` cases, so a missing row is never ambiguous with "the
 *    service was never called."
 *
 * 3. RECIPIENTS COME FROM THE ALREADY-FETCHED ENTITY. Every method takes
 *    the guestName/guestEmail/guestPhone snapshot already present on the
 *    triggering `Reservation`/`Order`/`CateringInquiry`/`CateringEvent`
 *    row (the same "contact snapshot at time of booking/order, independent
 *    of any linked account" convention used throughout this codebase) —
 *    never a fresh join out to `Customer`/`User`.
 *
 * 4. PUSH IS NEVER DISPATCHED. This build has no device-token/push-
 *    subscription registration flow anywhere, so there is no recipient to
 *    push to — see lib/notifications/PushProvider.ts's header. Every
 *    method below only ever attempts EMAIL and SMS.
 *
 * 5. REMINDER-TYPE METHODS ARE STANDALONE. `sendReservationReminder`,
 *    `sendDepositReminder`, `sendCateringReminder`, and
 *    `sendPaymentReminder` are fully implemented and callable, but nothing
 *    in this codebase calls them automatically — there is no cron/
 *    scheduler infrastructure in any prior phase. They exist ready to be
 *    invoked from a future scheduled job (e.g. "reservations starting in
 *    24h" or "catering events in 3 days"), matching the same "build the
 *    correct interface, flag what's not wired" discipline used elsewhere
 *    in this build.
 */

interface RecipientInfo {
  guestName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
}

/** ₱-prefixed, two-decimal money string — same convention as InvoiceService's error copy. */
function formatMoney(amount: Prisma.Decimal | string | number): string {
  return `₱${new Prisma.Decimal(amount as never).toFixed(2)}`;
}

/**
 * Guest-facing date/time formatting. Defaults to 'Asia/Manila' — this
 * build's Philippine-market default timezone (see docs/architecture.md) —
 * rather than looking up the actual branch timezone, because notification
 * bodies are best-effort display text, not authoritative data, and every
 * call site already has its entity in hand without an extra branch query.
 */
function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export class NotificationService {
  /**
   * Notification delivery history — every attempted send, one row per
   * channel per attempt (see class header point 2), newest first. Backs
   * the Phase 14 dashboard/API so staff can confirm "did the confirmation
   * actually go out" without touching the database directly.
   */
  static async list(organizationId: string, branchId: string, query: ListNotificationsQueryInput) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.notification.findMany({
      where: {
        organizationId,
        branchId,
        type: query.type,
        channel: query.channel,
        status: query.status,
        relatedEntityType: query.relatedEntityType,
        relatedEntityId: query.relatedEntityId,
      },
      orderBy: { createdAt: 'desc' },
      take: query.take,
    });
  }

  /** Master spec §40: "Reservation confirmation". Fired when a reservation transitions to CONFIRMED — see ReservationService.updateStatus. */
  static async sendReservationConfirmation(
    organizationId: string,
    branchId: string,
    reservation: RecipientInfo & { id: string; startAt: Date; guestCount: number },
  ): Promise<void> {
    const subject = 'Reservation Confirmed';
    const body =
      `Hi ${reservation.guestName ?? 'there'}, your reservation for ${reservation.guestCount} guest(s) on ` +
      `${formatDateTime(reservation.startAt)} has been confirmed. Reservation ID: ${reservation.id}.`;
    await this.send(organizationId, branchId, 'RESERVATION_CONFIRMATION', 'Reservation', reservation.id, reservation, subject, body);
  }

  /** Master spec §40: "Reservation reminder". Standalone — see class header point 5. */
  static async sendReservationReminder(
    organizationId: string,
    branchId: string,
    reservation: RecipientInfo & { id: string; startAt: Date; guestCount: number },
  ): Promise<void> {
    const subject = 'Reservation Reminder';
    const body =
      `Hi ${reservation.guestName ?? 'there'}, this is a reminder of your upcoming reservation for ` +
      `${reservation.guestCount} guest(s) on ${formatDateTime(reservation.startAt)}. Reservation ID: ${reservation.id}.`;
    await this.send(organizationId, branchId, 'RESERVATION_REMINDER', 'Reservation', reservation.id, reservation, subject, body);
  }

  /** Master spec §40: "Deposit reminder". Standalone — see class header point 5. Scoped to Reservation, the only entity with a single depositAmount field (Catering deposits are individual CateringPayment rows instead — see schema.prisma). */
  static async sendDepositReminder(
    organizationId: string,
    branchId: string,
    reservation: RecipientInfo & { id: string; startAt: Date; depositAmount: Prisma.Decimal | string | null },
  ): Promise<void> {
    const subject = 'Deposit Reminder';
    const amount = reservation.depositAmount ? formatMoney(reservation.depositAmount) : 'the required amount';
    const body =
      `Hi ${reservation.guestName ?? 'there'}, a deposit of ${amount} is still required to secure your reservation on ` +
      `${formatDateTime(reservation.startAt)}. Reservation ID: ${reservation.id}.`;
    await this.send(organizationId, branchId, 'DEPOSIT_REMINDER', 'Reservation', reservation.id, reservation, subject, body);
  }

  /** Master spec §40: "Order confirmation". Fired at order creation — see OrderService.createOrder. */
  static async sendOrderConfirmation(
    organizationId: string,
    branchId: string,
    order: RecipientInfo & { id: string; total: Prisma.Decimal | string; type: string },
  ): Promise<void> {
    const subject = 'Order Received';
    const body =
      `Hi ${order.guestName ?? 'there'}, thank you! Your ${order.type.toLowerCase().replace('_', ' ')} order totaling ` +
      `${formatMoney(order.total)} has been received. Order ID: ${order.id}.`;
    await this.send(organizationId, branchId, 'ORDER_CONFIRMATION', 'Order', order.id, order, subject, body);
  }

  /** Master spec §40: "Order status". Fired on every order status transition — see OrderService.updateStatus. */
  static async sendOrderStatusUpdate(
    organizationId: string,
    branchId: string,
    order: RecipientInfo & { id: string; status: string },
  ): Promise<void> {
    const subject = 'Order Status Update';
    const body = `Hi ${order.guestName ?? 'there'}, your order (ID: ${order.id}) status is now ${order.status.replace('_', ' ')}.`;
    await this.send(organizationId, branchId, 'ORDER_STATUS', 'Order', order.id, order, subject, body);
  }

  /** Master spec §40: "Delivery updates". Fired on every delivery status transition — see DeliveryService.updateStatus. Recipient sourced from delivery.order, since DELIVERY_INCLUDE already includes it. */
  static async sendDeliveryUpdate(
    organizationId: string,
    branchId: string,
    delivery: { id: string; status: string; order: RecipientInfo & { id: string } },
  ): Promise<void> {
    const subject = 'Delivery Update';
    const body =
      `Hi ${delivery.order.guestName ?? 'there'}, your delivery for order ${delivery.order.id} is now ` +
      `${delivery.status.replace('_', ' ')}.`;
    await this.send(organizationId, branchId, 'DELIVERY_UPDATE', 'DeliveryOrder', delivery.id, delivery.order, subject, body);
  }

  /** Master spec §40: "Catering quotation". Fired when a quote transitions to SENT — see CateringService.updateQuoteStatus. Recipient sourced from quote.inquiry, since QUOTE_INCLUDE already includes it. */
  static async sendCateringQuotation(
    organizationId: string,
    branchId: string,
    quote: { id: string; total: Prisma.Decimal | string; inquiry: RecipientInfo & { id: string } },
  ): Promise<void> {
    const subject = 'Catering Quote Ready';
    const body =
      `Hi ${quote.inquiry.guestName ?? 'there'}, your catering quote totaling ${formatMoney(quote.total)} is ready for review. ` +
      `Quote ID: ${quote.id}.`;
    await this.send(organizationId, branchId, 'CATERING_QUOTATION', 'CateringQuote', quote.id, quote.inquiry, subject, body);
  }

  /** Master spec §40: "Catering reminder". Standalone — see class header point 5. */
  static async sendCateringReminder(
    organizationId: string,
    branchId: string,
    event: RecipientInfo & { id: string; eventDate: Date; guestCount: number },
  ): Promise<void> {
    const subject = 'Catering Event Reminder';
    const body =
      `Hi ${event.guestName ?? 'there'}, this is a reminder of your upcoming catering event for ${event.guestCount} guest(s) on ` +
      `${formatDateTime(event.eventDate)}. Event ID: ${event.id}.`;
    await this.send(organizationId, branchId, 'CATERING_REMINDER', 'CateringEvent', event.id, event, subject, body);
  }

  /**
   * Master spec §40: "Payment reminder". Standalone — see class header
   * point 5. Kept generic (relatedEntityType supplied by the caller)
   * because a balance can be due against either an Order or a
   * CateringEvent — unlike Deposit reminder, no single entity owns this
   * concept exclusively.
   */
  static async sendPaymentReminder(
    organizationId: string,
    branchId: string,
    params: RecipientInfo & { relatedEntityType: string; relatedEntityId: string; balanceDue: Prisma.Decimal | string },
  ): Promise<void> {
    const subject = 'Payment Reminder';
    const body =
      `Hi ${params.guestName ?? 'there'}, a balance of ${formatMoney(params.balanceDue)} remains due. ` +
      `Reference: ${params.relatedEntityId}.`;
    await this.send(organizationId, branchId, 'PAYMENT_REMINDER', params.relatedEntityType, params.relatedEntityId, params, subject, body);
  }

  /** Master spec §40: "Invoice". Fired on successful issuance — see InvoiceService.issueInvoice. Recipient sourced from the already-fetched order object at the top of that method. */
  static async sendInvoice(
    organizationId: string,
    branchId: string,
    params: { invoiceId: string; invoiceNumber: string; total: Prisma.Decimal | string; order: RecipientInfo & { id: string } },
  ): Promise<void> {
    const subject = `Invoice ${params.invoiceNumber}`;
    const body =
      `Hi ${params.order.guestName ?? 'there'}, your invoice ${params.invoiceNumber} totaling ${formatMoney(params.total)} ` +
      `has been issued for order ${params.order.id}.`;
    await this.send(organizationId, branchId, 'INVOICE', 'Invoice', params.invoiceId, params.order, subject, body);
  }

  /**
   * Master spec §40: "Review request". Fired from three places — see
   * class header / docs: OrderService.updateStatus (COMPLETED),
   * ReservationService.updateStatus (COMPLETED), CateringService
   * .updateEventStatus (COMPLETED) — the master spec lists this generically
   * without scoping it to one entity type, so relatedEntityType/Label are
   * caller-supplied.
   */
  static async sendReviewRequest(
    organizationId: string,
    branchId: string,
    params: RecipientInfo & { relatedEntityType: string; relatedEntityId: string; label: string },
  ): Promise<void> {
    const subject = "We'd Love Your Feedback";
    const body = `Hi ${params.guestName ?? 'there'}, thanks for choosing us! We'd love your feedback on your recent ${params.label}. Reference: ${params.relatedEntityId}.`;
    await this.send(organizationId, branchId, 'REVIEW_REQUEST', params.relatedEntityType, params.relatedEntityId, params, subject, body);
  }

  // --- internal dispatch ----------------------------------------------------

  /**
   * Attempts EMAIL and SMS independently (never PUSH — see class header
   * point 4), each producing its own `Notification` row. Never throws —
   * every failure mode (no recipient, no provider configured, provider
   * error) is recorded, not surfaced to the caller.
   */
  private static async send(
    organizationId: string,
    branchId: string,
    type: NotificationType,
    relatedEntityType: string,
    relatedEntityId: string,
    recipient: RecipientInfo,
    subject: string,
    body: string,
  ): Promise<void> {
    try {
      await Promise.all([
        this.dispatchEmail(organizationId, branchId, type, relatedEntityType, relatedEntityId, recipient.guestEmail ?? null, subject, body),
        this.dispatchSms(organizationId, branchId, type, relatedEntityType, relatedEntityId, recipient.guestPhone ?? null, body),
      ]);
    } catch (error) {
      // Both dispatch helpers already catch everything internally and
      // always write a Notification row rather than throwing — this outer
      // catch is a last-resort safety net so a truly unexpected error
      // (e.g. the audit-log-style DB write itself failing) still can't
      // propagate into the caller's already-committed business flow. Still
      // logged (§63 Observability) since it means BOTH the row write and
      // the dispatch attempt failed — the only case this class produces no
      // queryable Notification row at all.
      log.error('NotificationService.send: unexpected failure writing Notification row', error, { organizationId, branchId, type, relatedEntityType, relatedEntityId });
    }
  }

  private static async dispatchEmail(
    organizationId: string,
    branchId: string,
    type: NotificationType,
    relatedEntityType: string,
    relatedEntityId: string,
    to: string | null,
    subject: string,
    body: string,
  ): Promise<void> {
    if (!to) {
      await this.record({ organizationId, branchId, type, channel: 'EMAIL', status: 'SKIPPED_NO_RECIPIENT', recipient: null, subject, body, relatedEntityType, relatedEntityId });
      return;
    }
    const provider = getEmailProvider();
    if (provider.name === 'unconfigured') {
      await this.record({ organizationId, branchId, type, channel: 'EMAIL', status: 'SKIPPED_NOT_CONFIGURED', recipient: to, subject, body, relatedEntityType, relatedEntityId });
      return;
    }
    try {
      const result = await provider.send({ to, subject, body });
      await this.record({
        organizationId, branchId, type, channel: 'EMAIL',
        status: result.status === 'sent' ? 'SENT' : 'FAILED',
        recipient: to, subject, body, relatedEntityType, relatedEntityId,
        providerReference: result.providerReference,
      });
    } catch (error) {
      // Recorded in the Notification row (queryable/auditable per this
      // class's design principle 2) AND logged (§63 Observability) — a
      // provider outage should show up in both places, not just the DB.
      log.warn('Email dispatch failed', { organizationId, branchId, type, relatedEntityType, relatedEntityId, error: error instanceof Error ? error.message : String(error) });
      await this.record({
        organizationId, branchId, type, channel: 'EMAIL', status: 'FAILED',
        recipient: to, subject, body, relatedEntityType, relatedEntityId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private static async dispatchSms(
    organizationId: string,
    branchId: string,
    type: NotificationType,
    relatedEntityType: string,
    relatedEntityId: string,
    to: string | null,
    body: string,
  ): Promise<void> {
    if (!to) {
      await this.record({ organizationId, branchId, type, channel: 'SMS', status: 'SKIPPED_NO_RECIPIENT', recipient: null, subject: null, body, relatedEntityType, relatedEntityId });
      return;
    }
    const provider = getSmsProvider();
    if (provider.name === 'unconfigured') {
      await this.record({ organizationId, branchId, type, channel: 'SMS', status: 'SKIPPED_NOT_CONFIGURED', recipient: to, subject: null, body, relatedEntityType, relatedEntityId });
      return;
    }
    try {
      const result = await provider.send({ to, body });
      await this.record({
        organizationId, branchId, type, channel: 'SMS',
        status: result.status === 'sent' ? 'SENT' : 'FAILED',
        recipient: to, subject: null, body, relatedEntityType, relatedEntityId,
        providerReference: result.providerReference,
      });
    } catch (error) {
      log.warn('SMS dispatch failed', { organizationId, branchId, type, relatedEntityType, relatedEntityId, error: error instanceof Error ? error.message : String(error) });
      await this.record({
        organizationId, branchId, type, channel: 'SMS', status: 'FAILED',
        recipient: to, subject: null, body, relatedEntityType, relatedEntityId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Writes one notifications row — the single place every send attempt (successful or not) is persisted. Never throws its own errors upward beyond this class's public methods; a DB failure here is swallowed by the try/catch in dispatchEmail/dispatchSms's callers or `send`'s own catch. */
  private static async record(params: {
    organizationId: string;
    branchId: string;
    type: NotificationType;
    channel: NotificationChannel;
    status: NotificationStatus;
    recipient: string | null;
    subject: string | null;
    body: string;
    relatedEntityType: string;
    relatedEntityId: string;
    providerReference?: string;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await prisma.notification.create({
        data: {
          organizationId: params.organizationId,
          branchId: params.branchId,
          type: params.type,
          channel: params.channel,
          status: params.status,
          recipient: params.recipient,
          subject: params.subject,
          body: params.body,
          relatedEntityType: params.relatedEntityType,
          relatedEntityId: params.relatedEntityId,
          providerReference: params.providerReference ?? null,
          errorMessage: params.errorMessage ?? null,
          sentAt: params.status === 'SENT' ? new Date() : null,
        },
      });
    } catch {
      // Logging the notification attempt is itself best-effort — this
      // service must never throw into a caller that has already committed
      // its real business transaction (see class header point 1).
    }
  }

  private static async assertBranchInOrg(organizationId: string, branchId: string): Promise<void> {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
  }
}
