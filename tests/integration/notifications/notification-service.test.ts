import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { MenuService } from '@/services/menu/MenuService';
import { TableService } from '@/services/tables/TableService';
import { OrderService } from '@/services/orders/OrderService';
import { ReservationService } from '@/services/reservations/ReservationService';
import { DeliveryZoneService } from '@/services/delivery/DeliveryZoneService';
import { DriverService } from '@/services/delivery/DriverService';
import { DeliveryService } from '@/services/delivery/DeliveryService';
import { CateringService } from '@/services/catering/CateringService';
import { InvoiceService } from '@/services/invoicing/InvoiceService';
import { NotificationService } from '@/services/notifications/NotificationService';
import { resetDatabase } from '../../helpers/db';
import type { CreateCateringInquiryInput, CreateCateringQuoteInput } from '@/lib/validation/catering';

/**
 * No email/SMS provider is configured anywhere in this test run
 * (EMAIL_PROVIDER_KEY/SMS_PROVIDER_KEY are unset — see .env.test.example),
 * so every dispatch attempt against a real recipient is expected to land
 * on SKIPPED_NOT_CONFIGURED, never SENT — see lib/notifications/
 * EmailProvider.ts / SmsProvider.ts's "unconfigured stub" pattern. These
 * tests assert on that status, not on an actual message having gone out,
 * matching the rest of this build's "no real provider exists yet" posture
 * (same as Phase 1's PaymentProvider and Phase 13's AIProvider).
 */

function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

async function setupFixture(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Notification Test ${suffix}`,
    organizationEmail: `notification-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@notification-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  const branch = await BranchService.create(user.organizationId, { name: `Branch ${suffix}`, timezone: 'Asia/Manila' }, user.id);
  const category = await MenuService.createCategory(user.organizationId, { name: 'Mains', displayOrder: 0 }, user.id);
  const item = await MenuService.createItem(
    user.organizationId,
    { categoryId: category.id, name: 'Burger', price: '150.00', available: true, taxCategory: 'STANDARD' },
    user.id,
  );
  return { user, branch, item };
}

async function notificationsFor(organizationId: string, relatedEntityType: string, relatedEntityId: string) {
  return prisma.notification.findMany({
    where: { organizationId, relatedEntityType, relatedEntityId },
    orderBy: { channel: 'asc' },
  });
}

describe('NotificationService — direct calls (content + skip reasons)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('records SKIPPED_NOT_CONFIGURED for both channels when a full recipient is present', async () => {
    const { user, branch } = await setupFixture('a');
    await NotificationService.sendReservationConfirmation(user.organizationId, branch.id, {
      id: 'res-1',
      guestName: 'Ana',
      guestEmail: 'ana@example.com',
      guestPhone: '+639171234567',
      startAt: new Date(hoursFromNow(24)),
      guestCount: 4,
    });

    const rows = await notificationsFor(user.organizationId, 'Reservation', 'res-1');
    expect(rows).toHaveLength(2);
    const email = rows.find((r) => r.channel === 'EMAIL')!;
    const sms = rows.find((r) => r.channel === 'SMS')!;
    expect(email.type).toBe('RESERVATION_CONFIRMATION');
    expect(email.status).toBe('SKIPPED_NOT_CONFIGURED');
    expect(email.recipient).toBe('ana@example.com');
    expect(email.subject).toBe('Reservation Confirmed');
    expect(email.body).toContain('Ana');
    expect(email.body).toContain('4 guest(s)');
    expect(sms.status).toBe('SKIPPED_NOT_CONFIGURED');
    expect(sms.recipient).toBe('+639171234567');
    expect(sms.subject).toBeNull();
  });

  it('records SKIPPED_NO_RECIPIENT independently per channel when only one contact method is on file', async () => {
    const { user, branch } = await setupFixture('b');
    await NotificationService.sendOrderConfirmation(user.organizationId, branch.id, {
      id: 'order-1',
      guestName: 'Ben',
      guestEmail: 'ben@example.com',
      guestPhone: null,
      total: '218.00',
      type: 'TAKEOUT',
    });

    const rows = await notificationsFor(user.organizationId, 'Order', 'order-1');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.channel === 'EMAIL')!.status).toBe('SKIPPED_NOT_CONFIGURED');
    const sms = rows.find((r) => r.channel === 'SMS')!;
    expect(sms.status).toBe('SKIPPED_NO_RECIPIENT');
    expect(sms.recipient).toBeNull();
  });

  it('records SKIPPED_NO_RECIPIENT for both channels when no contact info exists at all', async () => {
    const { user, branch } = await setupFixture('c');
    await NotificationService.sendReviewRequest(user.organizationId, branch.id, {
      guestName: null,
      guestEmail: null,
      guestPhone: null,
      relatedEntityType: 'Order',
      relatedEntityId: 'order-anon',
      label: 'order',
    });
    const rows = await notificationsFor(user.organizationId, 'Order', 'order-anon');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'SKIPPED_NO_RECIPIENT')).toBe(true);
    expect(rows.every((r) => r.recipient === null)).toBe(true);
  });

  it('formats a deposit reminder amount as a ₱-prefixed two-decimal string', async () => {
    const { user, branch } = await setupFixture('d');
    await NotificationService.sendDepositReminder(user.organizationId, branch.id, {
      id: 'res-dep',
      guestName: 'Cara',
      guestEmail: 'cara@example.com',
      guestPhone: null,
      startAt: new Date(hoursFromNow(48)),
      depositAmount: '1500',
    });
    const rows = await notificationsFor(user.organizationId, 'Reservation', 'res-dep');
    const email = rows.find((r) => r.channel === 'EMAIL')!;
    expect(email.body).toContain('₱1500.00');
  });

  it('never throws even when persistence itself would be the only failure point (defensive: valid call always resolves)', async () => {
    const { user, branch } = await setupFixture('e');
    await expect(
      NotificationService.sendPaymentReminder(user.organizationId, branch.id, {
        guestName: 'Drew',
        guestEmail: 'drew@example.com',
        guestPhone: null,
        relatedEntityType: 'CateringEvent',
        relatedEntityId: 'event-1',
        balanceDue: '2500.00',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('NotificationService — wired into existing call sites', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('fires RESERVATION_CONFIRMATION when a reservation is confirmed, and REVIEW_REQUEST when it completes', async () => {
    const { user, branch } = await setupFixture('r1');
    const table = await TableService.createTable(user.organizationId, branch.id, { tableNumber: 'T1', capacity: 4 }, user.id);
    const reservation = await ReservationService.createReservation(
      user.organizationId,
      branch.id,
      {
        tableIds: [table.id],
        startAt: hoursFromNow(24),
        durationMinutes: 90,
        guestCount: 2,
        guestName: 'Reservation Guest',
        guestEmail: 'guest@example.com',
        depositRequired: false,
      },
      user.id,
    );

    // No notification yet — only CONFIRMED/COMPLETED trigger one.
    expect(await notificationsFor(user.organizationId, 'Reservation', reservation.id)).toHaveLength(0);

    await ReservationService.updateStatus(user.organizationId, branch.id, reservation.id, { status: 'CONFIRMED' }, user.id);
    const afterConfirm = await notificationsFor(user.organizationId, 'Reservation', reservation.id);
    expect(afterConfirm.some((n) => n.type === 'RESERVATION_CONFIRMATION')).toBe(true);

    await ReservationService.updateStatus(user.organizationId, branch.id, reservation.id, { status: 'SEATED' }, user.id);
    await ReservationService.updateStatus(user.organizationId, branch.id, reservation.id, { status: 'COMPLETED' }, user.id);
    const afterComplete = await notificationsFor(user.organizationId, 'Reservation', reservation.id);
    expect(afterComplete.some((n) => n.type === 'REVIEW_REQUEST')).toBe(true);
    // Still exactly the CONFIRMATION pair plus the REVIEW_REQUEST pair —
    // SEATED is not a notification-triggering transition.
    expect(afterComplete.filter((n) => n.type === 'RESERVATION_CONFIRMATION')).toHaveLength(2);
    expect(afterComplete.filter((n) => n.type === 'REVIEW_REQUEST')).toHaveLength(2);
  });

  it('fires ORDER_CONFIRMATION at creation, ORDER_STATUS on every transition, and REVIEW_REQUEST at COMPLETED', async () => {
    const { user, branch, item } = await setupFixture('o1');
    const order = await OrderService.createOrder(
      user.organizationId,
      branch.id,
      {
        type: 'TAKEOUT',
        discountAmount: '0.00',
        guestName: 'Order Guest',
        guestEmail: 'order-guest@example.com',
        items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
      },
      user.id,
    );
    let rows = await notificationsFor(user.organizationId, 'Order', order.id);
    expect(rows.some((n) => n.type === 'ORDER_CONFIRMATION')).toBe(true);
    expect(rows.some((n) => n.type === 'ORDER_STATUS')).toBe(false);

    await OrderService.updateStatus(user.organizationId, branch.id, order.id, { status: 'CONFIRMED' }, user.id);
    rows = await notificationsFor(user.organizationId, 'Order', order.id);
    expect(rows.some((n) => n.type === 'ORDER_STATUS')).toBe(true);
    expect(rows.some((n) => n.type === 'REVIEW_REQUEST')).toBe(false);

    await OrderService.updateStatus(user.organizationId, branch.id, order.id, { status: 'PREPARING' }, user.id);
    await OrderService.updateStatus(user.organizationId, branch.id, order.id, { status: 'READY' }, user.id);
    await OrderService.updateStatus(user.organizationId, branch.id, order.id, { status: 'COMPLETED' }, user.id);
    rows = await notificationsFor(user.organizationId, 'Order', order.id);
    // 4 status transitions (CONFIRMED/PREPARING/READY/COMPLETED) x 2
    // channels = 8 ORDER_STATUS rows, plus the COMPLETED-triggered
    // REVIEW_REQUEST pair.
    expect(rows.filter((n) => n.type === 'ORDER_STATUS')).toHaveLength(8);
    expect(rows.filter((n) => n.type === 'REVIEW_REQUEST')).toHaveLength(2);
  });

  it('fires DELIVERY_UPDATE on a delivery status transition, sourced from the order guest snapshot', async () => {
    const { user, branch, item } = await setupFixture('d1');
    const zone = await DeliveryZoneService.create(user.organizationId, branch.id, { name: 'Zone', deliveryFee: '50.00' }, user.id);
    const order = await OrderService.createOrder(
      user.organizationId,
      branch.id,
      {
        type: 'DELIVERY',
        deliveryAddress: '123 Test Ave',
        deliveryZoneId: zone.id,
        discountAmount: '0.00',
        guestName: 'Delivery Guest',
        guestPhone: '+639170000000',
        items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
      },
      user.id,
    );
    const deliveryOrderId = order.delivery!.id;

    const driverRole = await prisma.role.findFirstOrThrow({ where: { organizationId: user.organizationId, name: 'DRIVER' } });
    const driverUser = await prisma.user.create({
      data: {
        organizationId: user.organizationId,
        email: 'driver@notification-test-d1.local',
        passwordHash: 'irrelevant-for-this-test',
        firstName: 'Dave',
        lastName: 'Driver',
      },
    });
    await prisma.userRole.create({ data: { userId: driverUser.id, roleId: driverRole.id, organizationId: user.organizationId } });
    const driver = await DriverService.create(user.organizationId, branch.id, { userId: driverUser.id }, user.id);

    // assignDriver is a separate entry point from updateStatus (see
    // DeliveryService's own header comment) and is NOT one of the 7 wired
    // trigger sites — no notification expected from it.
    await DeliveryService.assignDriver(user.organizationId, branch.id, deliveryOrderId, { driverId: driver.id }, user.id);
    expect(await notificationsFor(user.organizationId, 'DeliveryOrder', deliveryOrderId)).toHaveLength(0);

    await DeliveryService.updateStatus(user.organizationId, branch.id, deliveryOrderId, { status: 'PICKED_UP' }, user.id);
    const rows = await notificationsFor(user.organizationId, 'DeliveryOrder', deliveryOrderId);
    expect(rows).toHaveLength(2);
    const firstNotification = rows[0];
    if (!firstNotification) throw new Error('Expected a delivery update notification');
    expect(firstNotification.type).toBe('DELIVERY_UPDATE');
    expect(rows.find((r) => r.channel === 'SMS')!.recipient).toBe('+639170000000');
  });

  it('fires CATERING_QUOTATION on SENT (not on other transitions), and REVIEW_REQUEST when the resulting event completes', async () => {
    const { user, branch } = await setupFixture('c1');
    const inquiryInput: CreateCateringInquiryInput = {
      guestName: 'Catering Guest',
      guestEmail: 'catering-guest@example.com',
      eventType: 'Wedding',
      eventDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      location: 'Grand Ballroom',
      guestCount: 30,
      deliveryRequested: false,
    };
    const inquiry = await CateringService.createInquiry(user.organizationId, branch.id, inquiryInput, user.id);
    const quoteInput: CreateCateringQuoteInput = {
      inquiryId: inquiry.id,
      guestCount: 30,
      items: [],
      staffingTotal: '0.00',
      equipmentTotal: '0.00',
      transportationTotal: '0.00',
      setupTotal: '0.00',
      serviceFeeTotal: '0.00',
      discountTotal: '0.00',
    };
    const quote = await CateringService.createQuote(user.organizationId, branch.id, quoteInput, user.id);

    await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'SENT' }, user.id);
    const afterSent = await notificationsFor(user.organizationId, 'CateringQuote', quote.id);
    expect(afterSent.some((n) => n.type === 'CATERING_QUOTATION')).toBe(true);

    await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'VIEWED' }, user.id);
    const afterViewed = await notificationsFor(user.organizationId, 'CateringQuote', quote.id);
    // VIEWED is not a trigger transition — still just the SENT pair.
    expect(afterViewed).toHaveLength(2);

    const accepted = await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'ACCEPTED' }, user.id);
    const eventId = accepted.event!.id;

    await CateringService.updateEventStatus(user.organizationId, branch.id, eventId, { status: 'IN_PROGRESS' }, user.id);
    expect(await notificationsFor(user.organizationId, 'CateringEvent', eventId)).toHaveLength(0);

    await CateringService.updateEventStatus(user.organizationId, branch.id, eventId, { status: 'COMPLETED' }, user.id);
    const eventRows = await notificationsFor(user.organizationId, 'CateringEvent', eventId);
    expect(eventRows.some((n) => n.type === 'REVIEW_REQUEST')).toBe(true);
  });

  it('fires INVOICE on successful issuance, sourced from the order guest snapshot', async () => {
    const { user, branch, item } = await setupFixture('i1');
    const order = await OrderService.createOrder(
      user.organizationId,
      branch.id,
      {
        type: 'TAKEOUT',
        discountAmount: '0.00',
        guestName: 'Invoice Guest',
        guestEmail: 'invoice-guest@example.com',
        items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
      },
      user.id,
    );
    await OrderService.recordPayment(user.organizationId, branch.id, order.id, { method: 'CASH', amount: '168.00', status: 'COMPLETED' }, user.id);
    const invoice = await InvoiceService.issueInvoice(user.organizationId, branch.id, order.id, user.id);

    const rows = await notificationsFor(user.organizationId, 'Invoice', invoice.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((n) => n.type === 'INVOICE')).toBe(true);
    const email = rows.find((r) => r.channel === 'EMAIL')!;
    expect(email.recipient).toBe('invoice-guest@example.com');
    expect(email.subject).toBe(`Invoice ${invoice.invoiceNumber}`);
    expect(email.body).toContain('₱168.00');
  });
});

describe('NotificationService.list', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('filters by type/status and is scoped to the requesting branch', async () => {
    const { user, branch } = await setupFixture('l1');
    const otherBranch = await BranchService.create(user.organizationId, { name: 'Other Branch', timezone: 'Asia/Manila' }, user.id);

    await NotificationService.sendReservationConfirmation(user.organizationId, branch.id, {
      id: 'res-list-1', guestName: 'A', guestEmail: 'a@example.com', guestPhone: null, startAt: new Date(hoursFromNow(1)), guestCount: 2,
    });
    await NotificationService.sendOrderConfirmation(user.organizationId, branch.id, {
      id: 'order-list-1', guestName: 'B', guestEmail: 'b@example.com', guestPhone: null, total: '100.00', type: 'TAKEOUT',
    });
    await NotificationService.sendReservationConfirmation(user.organizationId, otherBranch.id, {
      id: 'res-list-2', guestName: 'C', guestEmail: 'c@example.com', guestPhone: null, startAt: new Date(hoursFromNow(1)), guestCount: 2,
    });

    const all = await NotificationService.list(user.organizationId, branch.id, { take: 50 });
    // Only this branch's rows (2 sends x 1 EMAIL channel each, since
    // guestPhone was omitted -> SMS is SKIPPED_NO_RECIPIENT but still one
    // row) — 2 sends x 2 channel rows = 4.
    expect(all).toHaveLength(4);
    expect(all.every((n) => n.branchId === branch.id)).toBe(true);

    const onlyReservationConfirmations = await NotificationService.list(user.organizationId, branch.id, {
      type: 'RESERVATION_CONFIRMATION',
      take: 50,
    });
    expect(onlyReservationConfirmations).toHaveLength(2);
    expect(onlyReservationConfirmations.every((n) => n.type === 'RESERVATION_CONFIRMATION')).toBe(true);

    const onlySkippedNotConfigured = await NotificationService.list(user.organizationId, branch.id, {
      status: 'SKIPPED_NOT_CONFIGURED',
      take: 50,
    });
    expect(onlySkippedNotConfigured.every((n) => n.status === 'SKIPPED_NOT_CONFIGURED')).toBe(true);
    expect(onlySkippedNotConfigured.length).toBeGreaterThan(0);
  });

  it('rejects a branch that does not belong to the caller\'s organization', async () => {
    const { user } = await setupFixture('l2');
    const other = await setupFixture('l3');
    await expect(NotificationService.list(user.organizationId, other.branch.id, { take: 50 })).rejects.toThrow();
  });
});
