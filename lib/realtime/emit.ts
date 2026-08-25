import 'server-only';
import type { CustomerNotificationCategory, Prisma, PrismaClient } from '@prisma/client';

/**
 * CAPP Phase 7 — the transactional outbox writer for real-time sync (spec
 * § 43, design decision in docs/customer-app/architecture.md § 6). Despite
 * that doc section claiming Phase 1 already wired "2-3 real emit call
 * sites", nothing had ever actually called `prisma.realtimeEvent.create`
 * anywhere in this codebase before this phase — the `RealtimeEvent` table
 * existed with zero writers. This is that writer, plus its first real call
 * sites (see the per-service edits this phase touches).
 *
 * `REALTIME_EVENT_TYPES` is spec § 43's catalog, deliberately narrowed to
 * what this build can *honestly* fire:
 *
 *   - `PaymentFailed` is omitted. Every payment-status enum in this codebase
 *     (`OrderPaymentStatus`, `CateringPaymentStatus`) is
 *     PENDING | COMPLETED | REFUNDED — there is no FAILED state anywhere a
 *     payment could land, because there's no real payment gateway
 *     (`lib/payments/PaymentProvider.ts`) to report a decline. Emitting
 *     `PaymentFailed` from a state that can never actually be reached would
 *     be exactly the kind of fake signal this codebase's "no fake
 *     integrations" principle forbids.
 *   - `PromotionCreated`/`PromotionUpdated`/`PromotionStarted`/
 *     `PromotionEnded`/`CampaignScheduled`/`CampaignSent` shipped in CAPP
 *     Phase 8 (see PromotionService/PromotionCampaignService) — all six are
 *     broadcast events (no `customerAccountId`), same as
 *     `MenuItemAvailabilityChanged`: the customer app's Promotions screen
 *     refetches its active/upcoming list for any connected diner, not one
 *     targeted individual. `CampaignSent` in particular is a staff-audit-
 *     style signal ("a campaign went out") — it does not fan the offer out
 *     to each targeted customer's own stream; actually delivering a
 *     personal push/in-app notification per audience member is CAPP Phase
 *     9's job (see docs/customer-app/architecture.md § 17).
 *   - `NotificationCreated` shipped in CAPP Phase 9 (see below) — the gap
 *     this comment used to describe (no `customerAccountId` on
 *     `NotificationService`'s guest-contact snapshot, no notification-
 *     center UI to consume it) is a separate, still-real limitation of the
 *     base platform's *own* staff-triggered Notification model, which this
 *     event does not come from. `NotificationCreated` fires instead
 *     whenever `writeCustomerNotification` below inserts a
 *     `CustomerNotification` row — the customer app's own in-app
 *     notification-center entry, a CAPP-only concept `NotificationService`
 *     has no part in. See architecture.md § 18.
 *
 * Every other spec § 43 event maps onto a real, reachable state transition
 * in this build and is wired.
 */
export const REALTIME_EVENT_TYPES = [
  'ReservationCreated',
  'ReservationConfirmed',
  'ReservationCancelled',
  'OrderCreated',
  'OrderAccepted',
  'OrderPreparing',
  'OrderReady',
  'OrderOutForDelivery',
  'OrderDelivered',
  'PaymentConfirmed',
  'CateringInquiryCreated',
  'CateringQuoteCreated',
  'CateringQuoteAccepted',
  'MenuItemAvailabilityChanged',
  // CAPP Phase 8 — Promotions.
  'PromotionCreated',
  'PromotionUpdated',
  'PromotionStarted',
  'PromotionEnded',
  'CampaignScheduled',
  'CampaignSent',
  // CAPP Phase 9 — Notifications. Fired by writeCustomerNotification below,
  // never emitted directly by a call site the way every other event above
  // is — see that function's own header.
  'NotificationCreated',
  // CAPP Phase 10 — Loyalty (spec § 37). All three fire from LoyaltyService
  // — see that class for the exact trigger points (order completion for
  // the first two, LOYALTY_REWARD promotion redemption for the third,
  // matching spec § 57's "Loyalty reward used" funnel event).
  'LoyaltyPointsEarned',
  'LoyaltyTierChanged',
  'LoyaltyRewardRedeemed',
] as const;
export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

/**
 * Content for the `CustomerNotification` (spec § 27 "Notification Center")
 * row a personal event should also leave behind, alongside the live
 * `RealtimeEvent` — see `emitRealtimeEvent`'s `notification` option below.
 * Optional per call site: a personal event with nothing worth showing in a
 * persistent history (there are none among this build's wired events, but
 * the option exists for a future one) simply omits it.
 */
export interface NotificationContent {
  category: CustomerNotificationCategory;
  title: string;
  message: string;
  deepLink?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

interface EmitRealtimeEventInput {
  organizationId: string;
  type: RealtimeEventType;
  /**
   * The CustomerAccount this event is personally addressed to (resolve with
   * `resolveEventCustomerAccountId` below) — omit/null for a broadcast
   * event with no single owner (`MenuItemAvailabilityChanged`), which every
   * connected client receives whether signed in or not. A personal event
   * with no resolvable account (a staff-created walk-in reservation/order
   * with no linked CustomerAccount) also passes null here deliberately —
   * the row still gets recorded for the outbox's own sake, it just has no
   * app session to ever deliver it to.
   */
  customerAccountId?: string | null;
  payload: Record<string, unknown>;
  /**
   * CAPP Phase 9: when both this and `customerAccountId` are set, a
   * `CustomerNotification` row is written in the same transaction, and a
   * second, generic `NotificationCreated` event fires alongside the
   * business-specific one above it — see `writeCustomerNotification`.
   * Omitted (as it always was pre-Phase-9) for a broadcast event, or for a
   * personal event this call site has decided isn't worth a permanent
   * notification-center entry.
   */
  notification?: NotificationContent;
}

/**
 * Writes a `realtime_events` row. Takes either the shared client or a
 * transaction client — every call site in this phase passes the same `tx`
 * its primary write used, so the event can never be observed as "written"
 * without the change that caused it (or vice versa) — the whole point of
 * the outbox pattern (see architecture.md § 6).
 */
export async function emitRealtimeEvent(
  client: PrismaClient | Prisma.TransactionClient,
  input: EmitRealtimeEventInput,
): Promise<void> {
  await client.realtimeEvent.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      customerAccountId: input.customerAccountId ?? null,
      payload: input.payload as Prisma.InputJsonValue,
    },
  });

  if (input.customerAccountId && input.notification) {
    await writeCustomerNotification(client, input.organizationId, input.customerAccountId, input.notification);
  }
}

/**
 * Writes one `CustomerNotification` row (spec § 27) and, alongside it, a
 * generic `NotificationCreated` `RealtimeEvent` — the live-delivery signal
 * an already-open app uses to update its unread badge without polling the
 * notification-center list. Two call shapes:
 *
 *   1. Via `emitRealtimeEvent`'s `notification` option — the common case,
 *      for a business event (OrderAccepted, PaymentConfirmed, ...) that
 *      should also leave a permanent record. Both events land in the same
 *      transaction as the primary write that caused them.
 *   2. Directly — for a notification with no corresponding spec § 43
 *      business event to piggyback on (e.g. `PromotionService.claim`'s
 *      "offer saved" confirmation, or `PromotionCampaignService.send`'s
 *      per-audience-member fan-out). `NotificationCreated` is still the
 *      only `RealtimeEvent` type these produce — inventing a bespoke event
 *      type per notification source is exactly what `RealtimeEvent.type`
 *      being a plain string (not a fixed enum, see this file's own header)
 *      was designed to avoid needing.
 *
 * Exported separately from `emitRealtimeEvent` (rather than folded
 * silently inside it) because call site 2 above needs it standalone.
 */
export async function writeCustomerNotification(
  client: PrismaClient | Prisma.TransactionClient,
  organizationId: string,
  customerAccountId: string,
  content: NotificationContent,
  campaignId?: string,
) {
  const created = await client.customerNotification.create({
    data: {
      organizationId,
      customerAccountId,
      category: content.category,
      title: content.title,
      message: content.message,
      deepLink: content.deepLink ?? null,
      relatedEntityType: content.relatedEntityType ?? null,
      relatedEntityId: content.relatedEntityId ?? null,
      campaignId: campaignId ?? null,
    },
  });
  await client.realtimeEvent.create({
    data: {
      organizationId,
      type: 'NotificationCreated',
      customerAccountId,
      payload: { notificationId: created.id, category: created.category, title: created.title },
    },
  });
  return created;
}

/**
 * Resolves the CustomerAccount linked to a CRM `Customer` row, if any — the
 * identity a personal event should be addressed to. Every call site already
 * has a `customerId` (or none) in hand from the entity it's emitting an
 * event for; this is the one extra lookup needed to turn that into the
 * account id `emitRealtimeEvent` filters delivery on. Returns null for a
 * missing/unlinked customer (walk-in, phone booking, or no customerId at
 * all) rather than throwing — an event with no deliverable recipient is a
 * normal, expected case, not an error.
 */
export async function resolveEventCustomerAccountId(
  client: PrismaClient | Prisma.TransactionClient,
  customerId: string | null | undefined,
): Promise<string | null> {
  if (!customerId) return null;
  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: { customerAccountId: true },
  });
  return customer?.customerAccountId ?? null;
}
