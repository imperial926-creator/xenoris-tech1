import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { TableService } from '@/services/tables/TableService';
import { MenuService } from '@/services/menu/MenuService';
import { OrderService } from '@/services/orders/OrderService';
import { CustomerService } from '@/services/crm/CustomerService';
import { ReservationService } from '@/services/reservations/ReservationService';
import { InventoryService } from '@/services/inventory/InventoryService';
import { AccountingService } from '@/services/accounting/AccountingService';
import { CateringService } from '@/services/catering/CateringService';
import { AnalyticsService } from '@/services/analytics/AnalyticsService';
import { resetDatabase } from '../../helpers/db';
import type { CreateJournalEntryInput } from '@/lib/validation/accounting';

async function setupFixture(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Analytics Test ${suffix}`,
    organizationEmail: `analytics-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@analytics-test-${suffix}.local`,
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
  return { user, branch, category, item };
}

/** This build's "this_month" preset over `now()` â€” the query every test below uses, since every fixture's timestamps default to `now()`. */
const THIS_MONTH = { preset: 'this_month' as const };

function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

describe('AnalyticsService.getRevenueDashboard', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('sums non-cancelled order totals, excludes cancelled orders, and the trend buckets sum to the reported total', async () => {
    const { user, branch, item } = await setupFixture('rev-a');
    const orderA = await OrderService.createOrder(user.organizationId, branch.id, { type: 'TAKEOUT', discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] }, user.id);
    const orderB = await OrderService.createOrder(user.organizationId, branch.id, { type: 'DELIVERY', discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 2, modifierIds: [] }] }, user.id);
    const cancelled = await OrderService.createOrder(user.organizationId, branch.id, { type: 'TAKEOUT', discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] }, user.id);
    await OrderService.updateStatus(user.organizationId, branch.id, cancelled.id, { status: 'CANCELLED', cancellationReason: 'test' }, user.id);

    const dashboard = await AnalyticsService.getRevenueDashboard(user.organizationId, THIS_MONTH);

    const expectedTotal = orderA.total.plus(orderB.total);
    expect(dashboard.totalRevenue.toString()).toBe(expectedTotal.toString());
    expect(dashboard.orderCount).toBe(2);
    const trendSum = dashboard.trend.reduce((sum, t) => sum + Number(t.revenue), 0);
    expect(trendSum.toFixed(2)).toBe(expectedTotal.toFixed(2));
  });

  it('includes settled catering BALANCE payments in total revenue, attributed by payment date', async () => {
    const { user, branch } = await setupFixture('rev-b');
    const inquiry = await CateringService.createInquiry(user.organizationId, branch.id, {
      guestName: 'Test Guest', eventType: 'Birthday', eventDate: hoursFromNow(48), location: 'Branch hall', guestCount: 20,
    }, user.id);
    const quote = await CateringService.createQuote(user.organizationId, branch.id, {
      inquiryId: inquiry.id, guestCount: 20,
      items: [{ description: 'Buffet', quantity: 20, unitPrice: '300.00' }],
      staffingTotal: '0', equipmentTotal: '0', transportationTotal: '0', setupTotal: '0', serviceFeeTotal: '0', discountTotal: '0',
    }, user.id);
    await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'SENT' }, user.id);
    const accepted = await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'ACCEPTED' }, user.id);
    const eventId = accepted.event!.id;
    await CateringService.recordPayment(user.organizationId, branch.id, eventId, { type: 'BALANCE', method: 'CASH', amount: quote.total.toString(), status: 'COMPLETED' }, user.id);

    const dashboard = await AnalyticsService.getRevenueDashboard(user.organizationId, THIS_MONTH);
    expect(dashboard.cateringRevenue.toString()).toBe(quote.total.toString());
    expect(dashboard.totalRevenue.toString()).toBe(quote.total.toString());
  });

  it('reports a null percent-change when the previous period had no revenue', async () => {
    const { user, branch, item } = await setupFixture('rev-c');
    await OrderService.createOrder(user.organizationId, branch.id, { type: 'TAKEOUT', discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] }, user.id);

    const dashboard = await AnalyticsService.getRevenueDashboard(user.organizationId, { preset: 'today' });
    expect(dashboard.percentChangeVsPreviousPeriod).toBeNull();
    expect(dashboard.previousPeriod.totalRevenue.toString()).toBe('0');
  });

  it('scopes to a single branch when branchId is given', async () => {
    const { user, branch, item } = await setupFixture('rev-d');
    const branchB = await BranchService.create(user.organizationId, { name: 'Branch B', timezone: 'Asia/Manila' }, user.id);
    const categoryB = await MenuService.createCategory(user.organizationId, { name: 'Mains B', displayOrder: 0 }, user.id);
    const itemB = await MenuService.createItem(user.organizationId, { categoryId: categoryB.id, name: 'Pasta', price: '200.00', available: true, taxCategory: 'STANDARD' }, user.id);

    const orderA = await OrderService.createOrder(user.organizationId, branch.id, { type: 'TAKEOUT', discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] }, user.id);
    await OrderService.createOrder(user.organizationId, branchB.id, { type: 'TAKEOUT', discountAmount: '0.00', items: [{ menuItemId: itemB.id, quantity: 1, modifierIds: [] }] }, user.id);

    const dashboard = await AnalyticsService.getRevenueDashboard(user.organizationId, { ...THIS_MONTH, branchId: branch.id });
    expect(dashboard.totalRevenue.toString()).toBe(orderA.total.toString());
    expect(dashboard.orderCount).toBe(1);
  });
});

describe('AnalyticsService.getProfitDashboard', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await prisma.$disconnect(); });

  async function postEntry(organizationId: string, actorUserId: string, entryDate: string, lines: { accountId: string; debit?: string; credit?: string }[]) {
    const input: CreateJournalEntryInput = { entryDate, description: 'Test entry', lines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit ?? '0', credit: l.credit ?? '0' })) };
    const created = await AccountingService.createJournalEntry(organizationId, input, actorUserId);
    return AccountingService.postJournalEntry(organizationId, created.id, actorUserId);
  }

  it("the trend buckets' netProfit sums exactly to the whole-range totals.netProfit â€” master spec's reconciliation requirement, extended to bucketing", async () => {
    const { user } = await setupFixture('profit-a');
    const list = await AccountingService.listAccounts(user.organizationId, {});
    const byName = new Map<string, (typeof list)[number]>();
    for (const a of list) byName.set(a.name, a);
    const cash = byName.get('Cash')!;
    const revenue = byName.get('Dine-in Revenue')!;
    const cogs = byName.get('Food Cost')!;
    const inventory = byName.get('Inventory')!;
    const rent = byName.get('Rent')!;

    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    // Three entries spread across the current month (day 2, day 15, and
    // whichever day `now` actually falls on) â€” a day-granularity trend
    // (this_month is well under 31 days) puts them in different buckets
    // whenever `now`'s day differs from 2 and 15, exercising the
    // multi-bucket summation path rather than a single trivial bucket.
    await postEntry(user.organizationId, user.id, `${y}-${m}-02T04:00:00.000Z`, [{ accountId: cash.id, debit: '1000.00' }, { accountId: revenue.id, credit: '1000.00' }]);
    await postEntry(user.organizationId, user.id, `${y}-${m}-15T04:00:00.000Z`, [{ accountId: cogs.id, debit: '300.00' }, { accountId: inventory.id, credit: '300.00' }]);
    await postEntry(user.organizationId, user.id, now.toISOString(), [{ accountId: rent.id, debit: '150.00' }, { accountId: cash.id, credit: '150.00' }]);

    const dashboard = await AnalyticsService.getProfitDashboard(user.organizationId, THIS_MONTH);

    const bucketSum = dashboard.trend.reduce((sum, t) => sum + Number(t.netProfit), 0);
    expect(bucketSum.toFixed(2)).toBe(dashboard.totals.netProfit.toFixed(2));
    expect(dashboard.totals.revenue.total.toFixed(2)).toBe('1000.00');
    expect(dashboard.totals.cogs.total.toFixed(2)).toBe('300.00');
    expect(dashboard.totals.netProfit.toFixed(2)).toBe('550.00');
  });

  it('rejects a branchId that does not belong to the organization', async () => {
    const { user } = await setupFixture('profit-b');
    await expect(AnalyticsService.getProfitDashboard(user.organizationId, { ...THIS_MONTH, branchId: 'does-not-exist' })).rejects.toThrow();
  });
});

describe('AnalyticsService.getCustomerAnalytics', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('counts new customers, and classifies a customer as repeat only if they ordered before this period', async () => {
    const { user, branch, item } = await setupFixture('cust-a');
    const repeatCustomer = await CustomerService.create(user.organizationId, { firstName: 'Repeat', lastName: 'Customer' }, user.id);
    const newCustomer = await CustomerService.create(user.organizationId, { firstName: 'New', lastName: 'Customer' }, user.id);

    // Backdate a prior order for repeatCustomer to simulate "ordered before
    // this period" â€” OrderService.createOrder has no createdAt input (every
    // order is stamped `now()`, by design, so nothing can silently
    // backdate itself through normal API use); this is a direct,
    // test-only timestamp adjustment on an already-validly-created row,
    // not a bypass of any business rule.
    const priorOrder = await OrderService.createOrder(user.organizationId, branch.id, { type: 'TAKEOUT', discountAmount: '0.00', customerId: repeatCustomer.id, items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] }, user.id);
    await prisma.order.update({ where: { id: priorOrder.id }, data: { createdAt: new Date('2020-01-01T00:00:00.000Z') } });

    await OrderService.createOrder(user.organizationId, branch.id, { type: 'TAKEOUT', discountAmount: '0.00', customerId: repeatCustomer.id, items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] }, user.id);
    await OrderService.createOrder(user.organizationId, branch.id, { type: 'TAKEOUT', discountAmount: '0.00', customerId: newCustomer.id, items: [{ menuItemId: item.id, quantity: 2, modifierIds: [] }] }, user.id);

    const analytics = await AnalyticsService.getCustomerAnalytics(user.organizationId, THIS_MONTH);

    expect(analytics.newCustomers).toBe(2); // both Customer profiles were created just now, in this_month
    expect(analytics.customersOrderingInRange).toBe(2);
    expect(analytics.repeatCustomers).toBe(1);
    expect(analytics.repeatRate).toBe(50);
    const top = analytics.topCustomers.find((c) => c.customerId === newCustomer.id);
    expect(top?.orderCount).toBe(1);
  });
});

describe('AnalyticsService.getProductAnalytics', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('ranks products by revenue/quantity and rolls revenue up by category', async () => {
    const { user, branch, category, item } = await setupFixture('prod-a');
    const category2 = await MenuService.createCategory(user.organizationId, { name: 'Drinks', displayOrder: 1 }, user.id);
    const drink = await MenuService.createItem(user.organizationId, { categoryId: category2.id, name: 'Soda', price: '50.00', available: true, taxCategory: 'STANDARD' }, user.id);

    // 3x Burger (150 each = 450 subtotal) + 1x Soda (50).
    await OrderService.createOrder(user.organizationId, branch.id, { type: 'TAKEOUT', discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 3, modifierIds: [] }, { menuItemId: drink.id, quantity: 1, modifierIds: [] }] }, user.id);

    const analytics = await AnalyticsService.getProductAnalytics(user.organizationId, THIS_MONTH);

    const topQuantityProduct = analytics.topProductsByQuantity[0];
    if (!topQuantityProduct) throw new Error('Expected a top product by quantity');
    expect(topQuantityProduct.menuItemId).toBe(item.id);
    expect(topQuantityProduct.quantitySold).toBe(3);
    const topRevenueProduct = analytics.topProductsByRevenue[0];
    if (!topRevenueProduct) throw new Error('Expected a top product by revenue');
    expect(topRevenueProduct.menuItemId).toBe(item.id); // 450 > 50
    const burgerCategory = analytics.revenueByCategory.find((c) => c.categoryId === category.id);
    const drinkCategory = analytics.revenueByCategory.find((c) => c.categoryId === category2.id);
    // revenue here traces back to a Prisma groupBy `_sum` aggregate (a real
    // SQL SUM()), not a direct column read or a `.plus()` chain over one â€”
    // compared numerically rather than by exact string, the same caution
    // CustomerService.getAnalytics already applies to its own `_sum` reads
    // (it calls `.toFixed(2)` rather than trusting `.toString()` there too).
    expect(Number(burgerCategory?.revenue)).toBeCloseTo(450, 6);
    expect(Number(drinkCategory?.revenue)).toBeCloseTo(50, 6);
  });
});

describe('AnalyticsService.getChannelAnalytics', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('splits revenue by order type, and the hour/weekday buckets each account for every order exactly once', async () => {
    const { user, branch, item } = await setupFixture('chan-a');
    await OrderService.createOrder(user.organizationId, branch.id, { type: 'DINE_IN', discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] }, user.id);
    await OrderService.createOrder(user.organizationId, branch.id, { type: 'TAKEOUT', discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] }, user.id);
    await OrderService.createOrder(user.organizationId, branch.id, { type: 'TAKEOUT', discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] }, user.id);

    const analytics = await AnalyticsService.getChannelAnalytics(user.organizationId, THIS_MONTH);

    const dineIn = analytics.byType.find((t) => t.type === 'DINE_IN');
    const takeout = analytics.byType.find((t) => t.type === 'TAKEOUT');
    expect(dineIn?.orderCount).toBe(1);
    expect(takeout?.orderCount).toBe(2);

    const hourTotal = analytics.salesByHour.reduce((sum, h) => sum + h.orderCount, 0);
    const weekdayTotal = analytics.salesByDayOfWeek.reduce((sum, d) => sum + d.orderCount, 0);
    expect(hourTotal).toBe(3);
    expect(weekdayTotal).toBe(3);
    expect(analytics.salesByHour.length).toBe(24);
    expect(analytics.salesByDayOfWeek.length).toBe(7);
  });
});

describe('AnalyticsService.getInventoryAnalytics', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('computes waste cost as quantity x ingredient.costPerUnit, and surfaces items at/below their reorder point', async () => {
    const { user, branch } = await setupFixture('inv-a');
    const unit = await InventoryService.createUnit(user.organizationId, { name: 'Kilogram', abbreviation: 'kg' }, user.id);
    const ingredient = await InventoryService.createIngredient(user.organizationId, { name: 'Flour', stockUnitId: unit.id, costPerUnit: '20.00' }, user.id);
    const invItem = await InventoryService.createInventoryItem(user.organizationId, branch.id, { ingredientId: ingredient.id, initialQuantity: '5', reorderPoint: '10' }, user.id);
    await InventoryService.recordWaste(user.organizationId, branch.id, invItem.id, { quantity: '2.5', reason: 'Spoilage' }, user.id);

    const analytics = await AnalyticsService.getInventoryAnalytics(user.organizationId, THIS_MONTH);

    // wasteCost.total is a computed (quantity x costPerUnit) figure, not a
    // direct DB column read, so its exact decimal.js string formatting
    // isn't asserted here (unlike the DB-passthrough fields below) â€”
    // compared numerically instead. 2.5 x 20.00 = 50.
    expect(Number(analytics.wasteCost.total)).toBeCloseTo(50, 6);
    const wastedIngredient = analytics.wasteCost.byIngredient.find((i) => i.ingredientId === ingredient.id);
    // `quantity` here is a direct WasteRecord.quantity DB read (NUMERIC(14,4)) â€”
    // Postgres returns it padded to the column's declared scale, same
    // convention tests/integration/reporting/reporting-service.test.ts
    // relies on for its own exact `.toString()` assertions.
    expect(wastedIngredient?.quantity.toFixed(4)).toBe('2.5000');
    // quantityOnHand (5) is at/below reorderPoint (10) from the moment the
    // item is created (initialQuantity below threshold) â€” LOW even before
    // the waste record further reduces it.
    expect(analytics.lowStockCount + analytics.criticalStockCount).toBeGreaterThanOrEqual(1);
    const flagged = analytics.lowStockItems.find((i) => i.id === invItem.id);
    expect(flagged).toBeDefined();
    expect(flagged?.stockLevel).toBe('LOW');
  });

  it('sums purchase spend from fully-received purchase orders', async () => {
    const { user, branch } = await setupFixture('inv-b');
    const unit = await InventoryService.createUnit(user.organizationId, { name: 'Kilogram', abbreviation: 'kg' }, user.id);
    const ingredient = await InventoryService.createIngredient(user.organizationId, { name: 'Rice', stockUnitId: unit.id, costPerUnit: '10.00' }, user.id);
    const supplier = await InventoryService.createSupplier(user.organizationId, { name: 'Test Supplier' }, user.id);
    const po = await InventoryService.createPurchaseOrder(user.organizationId, branch.id, {
      supplierId: supplier.id, items: [{ ingredientId: ingredient.id, unitId: unit.id, quantityOrdered: '100', unitCost: '15.00' }],
    }, user.id);
    await InventoryService.submitPurchaseOrder(user.organizationId, branch.id, po.id, user.id);
    const poItem = po.items[0];
    if (!poItem) throw new Error('Expected purchase order to contain an item');
    const received = await InventoryService.receivePurchaseOrderItems(user.organizationId, branch.id, po.id, { items: [{ purchaseOrderItemId: poItem.id, quantityReceived: '100' }] }, user.id);

    const analytics = await AnalyticsService.getInventoryAnalytics(user.organizationId, THIS_MONTH);
    // purchaseSpend.total is a Prisma `_sum` aggregate (real SQL SUM()) â€”
    // compared numerically rather than by exact string, same caution as
    // getProductAnalytics's revenue-by-category assertions above.
    expect(Number(analytics.purchaseSpend.total)).toBeCloseTo(Number(received.total), 6);
    expect(Number(analytics.purchaseSpend.total)).toBeCloseTo(1500, 6);
  });
});

describe('AnalyticsService.getOperationalAnalytics', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('counts reservations by status and reports table utilization within the active-table denominator', async () => {
    const { user, branch } = await setupFixture('ops-a');
    const table = await TableService.createTable(user.organizationId, branch.id, { tableNumber: 'T1', capacity: 4 }, user.id);
    await TableService.createTable(user.organizationId, branch.id, { tableNumber: 'T2', capacity: 4 }, user.id); // unused table â€” denominator, not numerator

    await ReservationService.createReservation(user.organizationId, branch.id, {
      tableIds: [table.id], startAt: hoursFromNow(2), durationMinutes: 90, guestCount: 2, guestName: 'Walk-in',
    }, user.id);

    const analytics = await AnalyticsService.getOperationalAnalytics(user.organizationId, THIS_MONTH);
    const pending = analytics.reservationsByStatus.find((r) => r.status === 'PENDING');
    expect(pending?.count).toBe(1);
    expect(analytics.tables.active).toBe(2);
  });
});

