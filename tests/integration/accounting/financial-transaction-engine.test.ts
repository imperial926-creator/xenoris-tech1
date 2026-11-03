import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { TableService } from '@/services/tables/TableService';
import { MenuService } from '@/services/menu/MenuService';
import { OrderService } from '@/services/orders/OrderService';
import { ReservationService } from '@/services/reservations/ReservationService';
import { CateringService } from '@/services/catering/CateringService';
import { InventoryService } from '@/services/inventory/InventoryService';
import { AccountingService } from '@/services/accounting/AccountingService';
import { resetDatabase } from '../../helpers/db';
import type { CreateCateringQuoteInput } from '@/lib/validation/catering';

/**
 * Master spec Â§49: "Create automated tests proving Total Debits = Total
 * Credits. Test: Revenue, Deposits, Refunds, Expenses, Inventory, COGS,
 * Accounts receivable, Accounts payable. Also test that deleting an order
 * does not corrupt accounting history." This file drives every one of those
 * business events through the REAL wiring (OrderService/ReservationService/
 * CateringService/InventoryService), not AccountingService directly, so it
 * proves the actual integration, not just the ledger primitives (those are
 * covered in accounting-service.test.ts).
 */

async function accountsByName(organizationId: string) {
  const list = await AccountingService.listAccounts(organizationId, {});
  // Explicit generic + populate-by-loop, not `new Map(list.map(...))` â€” see
  // prisma/seed.ts's identical fix; inferring the Map's value type straight
  // from a `.map()` callback collapses to `{}` under this project's
  // noUncheckedIndexedAccess + strict settings once Prisma's types are involved.
  const byName = new Map<string, (typeof list)[number]>();
  for (const a of list) byName.set(a.name, a);
  return byName;
}

function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

async function setupRestaurantFixture(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `FTE Test ${suffix}`,
    organizationEmail: `fte-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@fte-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  const branch = await BranchService.create(user.organizationId, { name: `Branch ${suffix}`, timezone: 'Asia/Manila' }, user.id);
  const table = await TableService.createTable(user.organizationId, branch.id, { tableNumber: 'T1', capacity: 4 }, user.id);
  const category = await MenuService.createCategory(user.organizationId, { name: 'Mains', displayOrder: 0 }, user.id);
  const item = await MenuService.createItem(
    user.organizationId,
    { categoryId: category.id, name: 'Chicken Inasal Meal', price: '220.00', available: true, taxCategory: 'STANDARD' },
    user.id,
  );
  return { user, branch, table, item };
}

async function stockRecipeFor(organizationId: string, branchId: string, menuItemId: string, actorUserId: string) {
  const kilogram = await InventoryService.createUnit(organizationId, { name: 'Kilogram', abbreviation: 'kg' }, actorUserId);
  const chicken = await InventoryService.createIngredient(organizationId, { name: 'Chicken', stockUnitId: kilogram.id, costPerUnit: '180.00' }, actorUserId);
  await InventoryService.createRecipe(
    organizationId,
    { menuItemId, yieldQuantity: '1', items: [{ ingredientId: chicken.id, quantity: '0.25', unitId: kilogram.id }] },
    actorUserId,
  );
  const item = await InventoryService.createInventoryItem(organizationId, branchId, { ingredientId: chicken.id, initialQuantity: '50' }, actorUserId);
  return { kilogram, chicken, item };
}

describe('Financial transaction engine â€” order revenue + COGS', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('completing a fully-paid order posts a balanced revenue entry (all Cash, no AR) and a balanced COGS entry', async () => {
    const { user, branch, table, item } = await setupRestaurantFixture('a');
    await stockRecipeFor(user.organizationId, branch.id, item.id, user.id);

    const order = await OrderService.createOrder(
      user.organizationId, branch.id,
      { type: 'DINE_IN', tableId: table.id, discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 2, modifierIds: [] }] },
      user.id,
    );
    // 2 x 220.00 = 440.00 subtotal, 12% VAT = 52.80, total = 492.80.
    expect(order.total.toFixed(2)).toBe('492.80');
    await OrderService.recordPayment(user.organizationId, branch.id, order.id, { method: 'CASH', amount: order.total.toFixed(2), status: 'COMPLETED' }, user.id);

    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'] as const) {
      await OrderService.updateStatus(user.organizationId, branch.id, order.id, { status }, user.id);
    }

    const acc = await accountsByName(user.organizationId);
    const revenueEntries = await prisma.journalEntry.findMany({
      where: { organizationId: user.organizationId, referenceType: 'Order', referenceId: order.id },
      include: { lines: true },
    });
    expect(revenueEntries).toHaveLength(2); // ORDER_REVENUE + ORDER_COGS, independently posted.

    const revenueEntry = revenueEntries.find((e) => e.lines.some((l) => l.accountId === acc.get('Dine-in Revenue')!.id))!;
    const revenueDebitTotal = revenueEntry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const revenueCreditTotal = revenueEntry.lines.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(revenueDebitTotal).toBe(revenueCreditTotal); // balanced
    const cashLine = revenueEntry.lines.find((l) => l.accountId === acc.get('Cash')!.id)!;
    expect(cashLine.debit.toFixed(2)).toBe('492.80'); // fully paid -> all Cash, no AR
    const arLine = revenueEntry.lines.find((l) => l.accountId === acc.get('Accounts Receivable')!.id);
    expect(arLine).toBeUndefined();
    const taxLine = revenueEntry.lines.find((l) => l.accountId === acc.get('Taxes Payable')!.id)!;
    expect(taxLine.credit.toFixed(2)).toBe('52.80');

    const cogsEntry = revenueEntries.find((e) => e.lines.some((l) => l.accountId === acc.get('Food Cost')!.id))!;
    const cogsDebitTotal = cogsEntry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const cogsCreditTotal = cogsEntry.lines.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(cogsDebitTotal).toBe(cogsCreditTotal);
    // 2 orders x 0.25kg x â‚±180.00/kg = â‚±90.00 COGS.
    const foodCostLine = cogsEntry.lines.find((l) => l.accountId === acc.get('Food Cost')!.id)!;
    expect(foodCostLine.debit.toFixed(2)).toBe('90.00');
    const inventoryLine = cogsEntry.lines.find((l) => l.accountId === acc.get('Inventory')!.id)!;
    expect(inventoryLine.credit.toFixed(2)).toBe('90.00');
  });

  it('completing an order with a partial payment splits revenue between Cash and Accounts Receivable', async () => {
    const { user, branch, table, item } = await setupRestaurantFixture('b');
    const order = await OrderService.createOrder(
      user.organizationId, branch.id,
      { type: 'DINE_IN', tableId: table.id, discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] },
      user.id,
    );
    // 220.00 + 12% = 246.40 total.
    await OrderService.recordPayment(user.organizationId, branch.id, order.id, { method: 'CASH', amount: '100.00', status: 'COMPLETED' }, user.id);
    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'] as const) {
      await OrderService.updateStatus(user.organizationId, branch.id, order.id, { status }, user.id);
    }

    const acc = await accountsByName(user.organizationId);
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId: user.organizationId, referenceType: 'Order', referenceId: order.id },
      include: { lines: true },
    });
    const cashLine = entry.lines.find((l) => l.accountId === acc.get('Cash')!.id)!;
    const arLine = entry.lines.find((l) => l.accountId === acc.get('Accounts Receivable')!.id)!;
    expect(cashLine.debit.toFixed(2)).toBe('100.00');
    expect(arLine.debit.toFixed(2)).toBe('146.40'); // 246.40 - 100.00
    const debitTotal = entry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const creditTotal = entry.lines.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(debitTotal).toBe(creditTotal);
  });

  it('deleting an order does not corrupt its accounting history â€” the journal entry and lines survive independently', async () => {
    const { user, branch, table, item } = await setupRestaurantFixture('c');
    const order = await OrderService.createOrder(
      user.organizationId, branch.id,
      { type: 'TAKEOUT', discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] },
      user.id,
    );
    await OrderService.recordPayment(user.organizationId, branch.id, order.id, { method: 'CASH', amount: order.total.toFixed(2), status: 'COMPLETED' }, user.id);
    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'] as const) {
      await OrderService.updateStatus(user.organizationId, branch.id, order.id, { status }, user.id);
    }
    const entryBefore = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId: user.organizationId, referenceType: 'Order', referenceId: order.id },
    });

    // Direct deletion (bypassing any service-level restriction) â€” proves the
    // ledger has no FK dependency back onto Order at all, only the loose
    // referenceType/referenceId string link.
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.orderPayment.deleteMany({ where: { orderId: order.id } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });

    const entryAfter = await prisma.journalEntry.findUnique({ where: { id: entryBefore.id }, include: { lines: true } });
    expect(entryAfter).not.toBeNull();
    expect(entryAfter!.status).toBe('POSTED');
    expect(entryAfter!.lines.length).toBeGreaterThan(0);
    const debitTotal = entryAfter!.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const creditTotal = entryAfter!.lines.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(debitTotal).toBe(creditTotal);
  });
});

describe('Financial transaction engine â€” reservation deposits (paid, refunded, earned)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('marking a deposit PAID posts Debit Cash / Credit Customer Deposits', async () => {
    const { user, branch, table } = await setupRestaurantFixture('d');
    const reservation = await ReservationService.createReservation(
      user.organizationId, branch.id,
      { tableIds: [table.id], startAt: hoursFromNow(24), durationMinutes: 90, guestCount: 2, guestName: 'Guest', depositRequired: true },
      user.id,
    );
    await ReservationService.recordDeposit(user.organizationId, branch.id, reservation.id, { depositStatus: 'PAID', depositAmount: '750.00' }, user.id);

    const acc = await accountsByName(user.organizationId);
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId: user.organizationId, referenceType: 'Reservation', referenceId: reservation.id },
      include: { lines: true },
    });
    const cashLine = entry.lines.find((l) => l.accountId === acc.get('Cash')!.id)!;
    const depositsLine = entry.lines.find((l) => l.accountId === acc.get('Customer Deposits')!.id)!;
    expect(cashLine.debit.toFixed(2)).toBe('750.00');
    expect(depositsLine.credit.toFixed(2)).toBe('750.00');
  });

  it('refunding a PAID deposit reverses Cash / Customer Deposits â€” a balanced refund entry', async () => {
    const { user, branch, table } = await setupRestaurantFixture('e');
    const reservation = await ReservationService.createReservation(
      user.organizationId, branch.id,
      { tableIds: [table.id], startAt: hoursFromNow(24), durationMinutes: 90, guestCount: 2, guestName: 'Guest', depositRequired: true },
      user.id,
    );
    await ReservationService.recordDeposit(user.organizationId, branch.id, reservation.id, { depositStatus: 'PAID', depositAmount: '750.00' }, user.id);
    await ReservationService.recordDeposit(user.organizationId, branch.id, reservation.id, { depositStatus: 'REFUNDED' }, user.id);

    const acc = await accountsByName(user.organizationId);
    const entries = await prisma.journalEntry.findMany({
      where: { organizationId: user.organizationId, referenceType: 'Reservation', referenceId: reservation.id },
      include: { lines: true },
    });
    expect(entries).toHaveLength(2); // DEPOSIT_RECEIVED + DEPOSIT_REFUNDED
    const refundEntry = entries.find((e) => e.description.toLowerCase().includes('refund'))!;
    const cashLine = refundEntry.lines.find((l) => l.accountId === acc.get('Cash')!.id)!;
    const depositsLine = refundEntry.lines.find((l) => l.accountId === acc.get('Customer Deposits')!.id)!;
    expect(cashLine.credit.toFixed(2)).toBe('750.00');
    expect(depositsLine.debit.toFixed(2)).toBe('750.00');
  });

  it('a reservation reaching COMPLETED with a PAID deposit recognizes the deposit as earned revenue', async () => {
    const { user, branch, table } = await setupRestaurantFixture('f');
    const reservation = await ReservationService.createReservation(
      user.organizationId, branch.id,
      { tableIds: [table.id], startAt: hoursFromNow(1), durationMinutes: 90, guestCount: 2, guestName: 'Guest', depositRequired: true },
      user.id,
    );
    await ReservationService.recordDeposit(user.organizationId, branch.id, reservation.id, { depositStatus: 'PAID', depositAmount: '500.00' }, user.id);
    await ReservationService.updateStatus(user.organizationId, branch.id, reservation.id, { status: 'CONFIRMED' }, user.id);
    await ReservationService.updateStatus(user.organizationId, branch.id, reservation.id, { status: 'SEATED' }, user.id);
    await ReservationService.updateStatus(user.organizationId, branch.id, reservation.id, { status: 'COMPLETED' }, user.id);

    const acc = await accountsByName(user.organizationId);
    // Two entries share this (referenceType, referenceId) â€” DEPOSIT_RECEIVED
    // (from recordDeposit above) and DEPOSIT_EARNED (from this COMPLETED
    // transition); ordering by createdAt picks the later, earned one.
    const earnedEntry = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId: user.organizationId, referenceType: 'Reservation', referenceId: reservation.id },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
    const depositsLine = earnedEntry.lines.find((l) => l.accountId === acc.get('Customer Deposits')!.id)!;
    const revenueLine = earnedEntry.lines.find((l) => l.accountId === acc.get('Dine-in Revenue')!.id)!;
    expect(depositsLine.debit.toFixed(2)).toBe('500.00');
    expect(revenueLine.credit.toFixed(2)).toBe('500.00');
  });

  it('a reservation reaching COMPLETED with NO deposit posts nothing extra', async () => {
    const { user, branch, table } = await setupRestaurantFixture('g');
    const reservation = await ReservationService.createReservation(
      user.organizationId, branch.id,
      { tableIds: [table.id], startAt: hoursFromNow(1), durationMinutes: 90, guestCount: 2, guestName: 'Guest', depositRequired: false },
      user.id,
    );
    await ReservationService.updateStatus(user.organizationId, branch.id, reservation.id, { status: 'CONFIRMED' }, user.id);
    await ReservationService.updateStatus(user.organizationId, branch.id, reservation.id, { status: 'SEATED' }, user.id);
    await ReservationService.updateStatus(user.organizationId, branch.id, reservation.id, { status: 'COMPLETED' }, user.id);

    const entries = await prisma.journalEntry.findMany({ where: { organizationId: user.organizationId, referenceType: 'Reservation', referenceId: reservation.id } });
    expect(entries).toHaveLength(0);
  });
});

describe('Financial transaction engine â€” catering deposits and balance settlement', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  function minimalQuoteInput(overrides: Partial<CreateCateringQuoteInput> & Pick<CreateCateringQuoteInput, 'inquiryId' | 'guestCount'>): CreateCateringQuoteInput {
    return {
      items: [], staffingTotal: '0.00', equipmentTotal: '0.00', transportationTotal: '0.00',
      setupTotal: '0.00', serviceFeeTotal: '0.00', discountTotal: '0.00', ...overrides,
    };
  }

  async function acceptedEvent(suffix: string) {
    const { user, branch } = await setupRestaurantFixture(suffix);
    const inquiry = await CateringService.createInquiry(
      user.organizationId, branch.id,
      { guestName: 'Test Customer', eventType: 'Birthday', eventDate: hoursFromNow(240), location: 'Client residence', guestCount: 10, deliveryRequested: false },
      user.id,
    );
    const quote = await CateringService.createQuote(
      user.organizationId, branch.id,
      minimalQuoteInput({ inquiryId: inquiry.id, guestCount: 10, items: [{ description: 'Buffet', quantity: 10, unitPrice: '50.00' }] }),
      user.id,
    );
    await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'SENT' }, user.id);
    const accepted = await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'ACCEPTED' }, user.id);
    return { user, branch, event: accepted.event! };
  }

  it('a DEPOSIT payment posts Debit Cash / Credit Customer Deposits â€” never straight to revenue (master spec Â§23)', async () => {
    const { user, branch, event } = await acceptedEvent('h');
    // event total = 10 x 50.00 = 500.00 + 12% tax = 560.00.
    await CateringService.recordPayment(user.organizationId, branch.id, event.id, { type: 'DEPOSIT', method: 'CASH', amount: '200.00', status: 'COMPLETED' }, user.id);

    const acc = await accountsByName(user.organizationId);
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId: user.organizationId, referenceType: 'CateringPayment' },
      include: { lines: true },
    });
    const cashLine = entry.lines.find((l) => l.accountId === acc.get('Cash')!.id)!;
    const depositsLine = entry.lines.find((l) => l.accountId === acc.get('Customer Deposits')!.id)!;
    expect(cashLine.debit.toFixed(2)).toBe('200.00');
    expect(depositsLine.credit.toFixed(2)).toBe('200.00');

    // No revenue posted yet.
    const revenueEntries = await prisma.journalEntryLine.findMany({ where: { accountId: acc.get('Catering Revenue')!.id } });
    expect(revenueEntries).toHaveLength(0);
  });

  it('a BALANCE payment recognizes revenue equal to actual payments received to date, not the quoted total', async () => {
    const { user, branch, event } = await acceptedEvent('i');
    await CateringService.recordPayment(user.organizationId, branch.id, event.id, { type: 'DEPOSIT', method: 'CASH', amount: '200.00', status: 'COMPLETED' }, user.id);
    await CateringService.recordPayment(user.organizationId, branch.id, event.id, { type: 'BALANCE', method: 'BANK_TRANSFER', amount: '360.00', status: 'COMPLETED' }, user.id);

    const acc = await accountsByName(user.organizationId);
    const balanceEntry = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId: user.organizationId, referenceType: 'CateringPayment', description: { contains: 'earned' } },
      include: { lines: true },
    });
    const cashLine = balanceEntry.lines.find((l) => l.accountId === acc.get('Cash')!.id)!;
    const depositsLine = balanceEntry.lines.find((l) => l.accountId === acc.get('Customer Deposits')!.id)!;
    const revenueLine = balanceEntry.lines.find((l) => l.accountId === acc.get('Catering Revenue')!.id)!;
    expect(cashLine.debit.toFixed(2)).toBe('360.00');
    expect(depositsLine.debit.toFixed(2)).toBe('200.00');
    // 200 (deposit) + 360 (balance) = 560.00, matching event.total exactly
    // in this scenario â€” but the entry is built from actual payments, not
    // event.total, per the design decision documented in AccountingService.
    expect(revenueLine.credit.toFixed(2)).toBe('560.00');
    expect(event.total.toFixed(2)).toBe('560.00');

    const debitTotal = balanceEntry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const creditTotal = balanceEntry.lines.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(debitTotal).toBe(creditTotal);
  });
});

describe('Financial transaction engine â€” inventory purchases and waste', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('receiving a purchase order posts Debit Inventory / Credit Accounts Payable', async () => {
    const { user, branch } = await setupRestaurantFixture('j');
    const kilogram = await InventoryService.createUnit(user.organizationId, { name: 'Kilogram', abbreviation: 'kg' }, user.id);
    const chicken = await InventoryService.createIngredient(user.organizationId, { name: 'Chicken', stockUnitId: kilogram.id, costPerUnit: '180.00' }, user.id);
    const supplier = await InventoryService.createSupplier(user.organizationId, { name: 'Manila Fresh Poultry' }, user.id);
    const po = await InventoryService.createPurchaseOrder(
      user.organizationId, branch.id,
      { supplierId: supplier.id, items: [{ ingredientId: chicken.id, unitId: kilogram.id, quantityOrdered: '10', unitCost: '190.00' }] },
      user.id,
    );
    await InventoryService.submitPurchaseOrder(user.organizationId, branch.id, po.id, user.id);
    const poItem = po.items[0];
    if (!poItem) {
      throw new Error('Expected purchase order to contain an item');
    }
    await InventoryService.receivePurchaseOrderItems(
      user.organizationId, branch.id, po.id,
      { items: [{ purchaseOrderItemId: poItem.id, quantityReceived: '10' }] },
      user.id,
    );

    const acc = await accountsByName(user.organizationId);
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId: user.organizationId, referenceType: 'InventoryTransaction' },
      include: { lines: true },
    });
    const inventoryLine = entry.lines.find((l) => l.accountId === acc.get('Inventory')!.id)!;
    const apLine = entry.lines.find((l) => l.accountId === acc.get('Accounts Payable')!.id)!;
    expect(inventoryLine.debit.toFixed(2)).toBe('1900.00'); // 10kg x 190.00
    expect(apLine.credit.toFixed(2)).toBe('1900.00');
  });

  it('partial receiving against the same PO posts a separate journal entry each time (not blocked by idempotency)', async () => {
    const { user, branch } = await setupRestaurantFixture('k');
    const kilogram = await InventoryService.createUnit(user.organizationId, { name: 'Kilogram', abbreviation: 'kg' }, user.id);
    const chicken = await InventoryService.createIngredient(user.organizationId, { name: 'Chicken', stockUnitId: kilogram.id, costPerUnit: '180.00' }, user.id);
    const supplier = await InventoryService.createSupplier(user.organizationId, { name: 'Manila Fresh Poultry' }, user.id);
    const po = await InventoryService.createPurchaseOrder(
      user.organizationId, branch.id,
      { supplierId: supplier.id, items: [{ ingredientId: chicken.id, unitId: kilogram.id, quantityOrdered: '10', unitCost: '190.00' }] },
      user.id,
    );
    await InventoryService.submitPurchaseOrder(user.organizationId, branch.id, po.id, user.id);
    const poItem = po.items[0];
    if (!poItem) {
      throw new Error('Expected purchase order to contain an item');
    }
    await InventoryService.receivePurchaseOrderItems(user.organizationId, branch.id, po.id, { items: [{ purchaseOrderItemId: poItem.id, quantityReceived: '6' }] }, user.id);
    await InventoryService.receivePurchaseOrderItems(user.organizationId, branch.id, po.id, { items: [{ purchaseOrderItemId: poItem.id, quantityReceived: '4' }] }, user.id);

    const entries = await prisma.journalEntry.findMany({ where: { organizationId: user.organizationId, referenceType: 'InventoryTransaction' } });
    expect(entries).toHaveLength(2); // one per receiving call â€” PO-level idempotency would have collapsed this to 1.
    const financialTransactions = await prisma.financialTransaction.findMany({ where: { organizationId: user.organizationId, type: 'INVENTORY_PURCHASE' } });
    expect(financialTransactions).toHaveLength(2);
  });

  it('recording waste posts Debit Waste / Credit Inventory', async () => {
    const { user, branch } = await setupRestaurantFixture('l');
    const kilogram = await InventoryService.createUnit(user.organizationId, { name: 'Kilogram', abbreviation: 'kg' }, user.id);
    const chicken = await InventoryService.createIngredient(user.organizationId, { name: 'Chicken', stockUnitId: kilogram.id, costPerUnit: '180.00' }, user.id);
    const stockItem = await InventoryService.createInventoryItem(user.organizationId, branch.id, { ingredientId: chicken.id, initialQuantity: '10' }, user.id);
    const waste = await InventoryService.recordWaste(user.organizationId, branch.id, stockItem.id, { quantity: '1.5', reason: 'Dropped on floor' }, user.id);

    const acc = await accountsByName(user.organizationId);
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId: user.organizationId, referenceType: 'WasteRecord', referenceId: waste.id },
      include: { lines: true },
    });
    const wasteLine = entry.lines.find((l) => l.accountId === acc.get('Waste')!.id)!;
    const inventoryLine = entry.lines.find((l) => l.accountId === acc.get('Inventory')!.id)!;
    expect(wasteLine.debit.toFixed(2)).toBe('270.00'); // 1.5kg x 180.00
    expect(inventoryLine.credit.toFixed(2)).toBe('270.00');
  });
});

describe('Financial transaction engine â€” every posted entry balances (SUM(DEBITS) = SUM(CREDITS))', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('after a mix of revenue, deposit, refund, expense, inventory, and COGS events, the trial balance still balances', async () => {
    const { user, branch, table, item } = await setupRestaurantFixture('m');
    await stockRecipeFor(user.organizationId, branch.id, item.id, user.id);

    // Order revenue + COGS.
    const order = await OrderService.createOrder(
      user.organizationId, branch.id,
      { type: 'DINE_IN', tableId: table.id, discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] },
      user.id,
    );
    await OrderService.recordPayment(user.organizationId, branch.id, order.id, { method: 'CASH', amount: order.total.toFixed(2), status: 'COMPLETED' }, user.id);
    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'] as const) {
      await OrderService.updateStatus(user.organizationId, branch.id, order.id, { status }, user.id);
    }

    // Reservation deposit paid then refunded.
    const table2 = await TableService.createTable(user.organizationId, branch.id, { tableNumber: 'T2', capacity: 2 }, user.id);
    const reservation = await ReservationService.createReservation(
      user.organizationId, branch.id,
      { tableIds: [table2.id], startAt: hoursFromNow(24), durationMinutes: 60, guestCount: 2, guestName: 'Guest', depositRequired: true },
      user.id,
    );
    await ReservationService.recordDeposit(user.organizationId, branch.id, reservation.id, { depositStatus: 'PAID', depositAmount: '300.00' }, user.id);
    await ReservationService.recordDeposit(user.organizationId, branch.id, reservation.id, { depositStatus: 'REFUNDED' }, user.id);

    // Expense (Accounts Payable via Rent, approved).
    const accountsBefore = await AccountingService.listAccounts(user.organizationId, {});
    const rentAccount = accountsBefore.find((a) => a.name === 'Rent')!;
    const category = await AccountingService.createExpenseCategory(user.organizationId, { name: 'Rent', defaultAccountId: rentAccount.id }, user.id);
    const expense = await AccountingService.createExpense(
      user.organizationId, branch.id,
      { categoryId: category.id, amount: '15000.00', expenseDate: new Date().toISOString(), paymentMethod: 'BANK_TRANSFER' },
      user.id,
    );
    await AccountingService.approveExpense(user.organizationId, branch.id, expense.id, user.id);

    // Inventory purchase (Accounts Payable).
    const kilogram = await InventoryService.createUnit(user.organizationId, { name: 'Kilogram (2)', abbreviation: 'kg2' }, user.id);
    const beef = await InventoryService.createIngredient(user.organizationId, { name: 'Beef', stockUnitId: kilogram.id, costPerUnit: '250.00' }, user.id);
    const supplier = await InventoryService.createSupplier(user.organizationId, { name: 'Fresh Meats Co' }, user.id);
    const po = await InventoryService.createPurchaseOrder(
      user.organizationId, branch.id,
      { supplierId: supplier.id, items: [{ ingredientId: beef.id, unitId: kilogram.id, quantityOrdered: '5', unitCost: '250.00' }] },
      user.id,
    );
    await InventoryService.submitPurchaseOrder(user.organizationId, branch.id, po.id, user.id);
    const poItem = po.items[0];
    if (!poItem) {
      throw new Error('Expected purchase order to contain an item');
    }
    await InventoryService.receivePurchaseOrderItems(user.organizationId, branch.id, po.id, { items: [{ purchaseOrderItemId: poItem.id, quantityReceived: '5' }] }, user.id);

    const trialBalance = await AccountingService.generateTrialBalance(user.organizationId);
    expect(trialBalance.isBalanced).toBe(true);
    expect(trialBalance.totalDebits.toString()).toBe(trialBalance.totalCredits.toString());
    expect(Number(trialBalance.totalDebits)).toBeGreaterThan(0);

    // Accounts Payable carries a real, non-zero balance from the inventory
    // purchase above (the BANK_TRANSFER-paid expense credits Bank, not AP â€”
    // see AccountingService.approveExpense). Accounts Receivable's
    // participation is exercised separately, in the partial-payment order
    // test above.
    const apRow = trialBalance.accounts.find((r) => r.name === 'Accounts Payable')!;
    expect(Number(apRow.balance)).toBeGreaterThan(0);
  });
});

