import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { MenuService } from '@/services/menu/MenuService';
import { OrderService } from '@/services/orders/OrderService';
import { CustomerService } from '@/services/crm/CustomerService';
import { InventoryService } from '@/services/inventory/InventoryService';
import { AccountingService } from '@/services/accounting/AccountingService';
import { InsightService } from '@/services/ai/InsightService';
import { resetDatabase } from '../../helpers/db';
import { dateKeyInTimezone, startOfDayInTimezone } from '@/lib/utils/timezone';
import type { CreateJournalEntryInput } from '@/lib/validation/accounting';

/**
 * Every fixture below registers with timezone 'Asia/Manila' (setupFixture),
 * and every test queries `{ preset: 'today' }` — resolveDateRangePreset's
 * 'today' is the full local calendar day, and InsightService's
 * `previousPeriod` helper then makes "the previous period" exactly
 * "yesterday" (same 24h duration, immediately before). That pairing is
 * what makes these two small time helpers sufficient to place fixtures
 * deterministically in "today" (current period) or "yesterday" (previous
 * period) without depending on wall-clock time-of-day when the test suite
 * happens to run.
 */
const TIMEZONE = 'Asia/Manila';
const TODAY = { preset: 'today' as const };

function localMidday(daysAgo: number): Date {
  const localMidnightToday = startOfDayInTimezone(new Date(), TIMEZONE);
  return new Date(localMidnightToday.getTime() - daysAgo * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
}
function localDateKey(daysAgo: number): string {
  return dateKeyInTimezone(localMidday(daysAgo), TIMEZONE);
}

async function setupFixture(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `AI Insight Test ${suffix}`,
    organizationEmail: `ai-insight-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@ai-insight-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: TIMEZONE,
  });
  const branch = await BranchService.create(user.organizationId, { name: `Branch ${suffix}`, timezone: TIMEZONE }, user.id);
  const category = await MenuService.createCategory(user.organizationId, { name: 'Mains', displayOrder: 0 }, user.id);
  const item = await MenuService.createItem(
    user.organizationId,
    { categoryId: category.id, name: 'Burger', price: '150.00', available: true, taxCategory: 'STANDARD' },
    user.id,
  );
  return { user, branch, category, item };
}

async function createOrderOn(
  organizationId: string,
  branchId: string,
  actorUserId: string,
  daysAgo: number,
  params: { itemId: string; quantity: number; type?: 'DINE_IN' | 'TAKEOUT' | 'DELIVERY'; customerId?: string },
) {
  const order = await OrderService.createOrder(
    organizationId,
    branchId,
    {
      type: params.type ?? 'TAKEOUT',
      discountAmount: '0.00',
      customerId: params.customerId,
      items: [{ menuItemId: params.itemId, quantity: params.quantity, modifierIds: [] }],
    },
    actorUserId,
  );
  if (daysAgo > 0) {
    await prisma.order.update({ where: { id: order.id }, data: { createdAt: localMidday(daysAgo) } });
  }
  return order;
}

async function postEntry(
  organizationId: string,
  actorUserId: string,
  entryDate: Date,
  lines: { accountId: string; debit?: string; credit?: string }[],
) {
  const input: CreateJournalEntryInput = {
    entryDate: entryDate.toISOString(),
    description: 'Test entry',
    lines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit ?? '0', credit: l.credit ?? '0' })),
  };
  const created = await AccountingService.createJournalEntry(organizationId, input, actorUserId);
  return AccountingService.postJournalEntry(organizationId, created.id, actorUserId);
}

async function accountsByName(organizationId: string) {
  const list = await AccountingService.listAccounts(organizationId, {});
  const byName = new Map<string, (typeof list)[number]>();
  for (const a of list) byName.set(a.name, a);
  return byName;
}

describe('InsightService.generateInsights — sales trend', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('surfaces a sales-trend insight, with dataSources, when revenue swings well past the default threshold', async () => {
    const { user, branch, item } = await setupFixture('sales-a');
    await createOrderOn(user.organizationId, branch.id, user.id, 1, { itemId: item.id, quantity: 1 }); // yesterday: 150
    await createOrderOn(user.organizationId, branch.id, user.id, 0, { itemId: item.id, quantity: 5 }); // today: 750, +400%

    const result = await InsightService.generateInsights(user.organizationId, TODAY);
    const sales = result.insights.find((i) => i.id === 'sales-trend');
    expect(sales).toBeDefined();
    expect(sales?.severity).toBe('OPPORTUNITY');
    expect(sales?.metrics[0]?.percentChange).toBe(400);
    // Master spec §38: "AI responses must always identify the underlying data used" — every surfaced insight must name its source.
    expect(sales?.dataSources.length).toBeGreaterThan(0);
    for (const insight of result.insights) {
      expect(insight.dataSources.length).toBeGreaterThan(0);
    }
  });

  it('does not surface a sales-trend insight when nothing crosses the default threshold', async () => {
    const { user, branch, item } = await setupFixture('sales-b');
    await createOrderOn(user.organizationId, branch.id, user.id, 1, { itemId: item.id, quantity: 2 }); // yesterday: 300
    await createOrderOn(user.organizationId, branch.id, user.id, 0, { itemId: item.id, quantity: 2 }); // today: 300, 0%

    const result = await InsightService.generateInsights(user.organizationId, TODAY);
    expect(result.insights.find((i) => i.id === 'sales-trend')).toBeUndefined();
  });
});

describe('InsightService.generateInsights — channel cost-vs-revenue divergence', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("mirrors the master spec's own worked example: delivery revenue up, delivery cost up faster", async () => {
    const { user, branch, item } = await setupFixture('div-a');
    const accounts = await accountsByName(user.organizationId);
    const cash = accounts.get('Cash')!;
    const deliveryCost = accounts.get('Delivery Cost')!;

    // Delivery revenue: yesterday 150 -> today 300 (+100%).
    await createOrderOn(user.organizationId, branch.id, user.id, 1, { itemId: item.id, quantity: 1, type: 'DELIVERY' });
    await createOrderOn(user.organizationId, branch.id, user.id, 0, { itemId: item.id, quantity: 2, type: 'DELIVERY' });
    // Delivery Cost (ledger): yesterday 1200 -> today 3600 (+200%) — well
    // above expenseMinAmount (1000) so both the channel-divergence and the
    // generic expense-trend rules are eligible to fire on this account.
    await postEntry(user.organizationId, user.id, localMidday(1), [{ accountId: deliveryCost.id, debit: '1200.00' }, { accountId: cash.id, credit: '1200.00' }]);
    await postEntry(user.organizationId, user.id, localMidday(0), [{ accountId: deliveryCost.id, debit: '3600.00' }, { accountId: cash.id, credit: '3600.00' }]);

    const result = await InsightService.generateInsights(user.organizationId, TODAY);

    const divergence = result.insights.find((i) => i.id === 'channel-divergence-delivery');
    expect(divergence).toBeDefined();
    expect(divergence?.severity).toBe('ATTENTION');
    expect(divergence?.category).toBe('EXPENSE');
    const revenueMetric = divergence?.metrics.find((m) => m.label === 'Delivery revenue');
    const costMetric = divergence?.metrics.find((m) => m.label === 'Delivery Cost');
    expect(revenueMetric?.percentChange).toBe(100);
    expect(costMetric?.percentChange).toBe(200);
    expect(divergence?.recommendations.length).toBeGreaterThan(0);

    // The generic per-account expense-trend rule fires independently on the
    // same ledger account — both are legitimate, distinct insights (one
    // channel-framed, one account-framed), not deduplicated by design.
    const expenseTrend = result.insights.find((i) => i.id === 'expense-trend-5040');
    expect(expenseTrend).toBeDefined();
    expect(expenseTrend?.severity).toBe('ATTENTION');
  });

  it('does not fire when a channel cost account never reaches the minimum amount floor', async () => {
    const { user, branch, item } = await setupFixture('div-b');
    const accounts = await accountsByName(user.organizationId);
    const cash = accounts.get('Cash')!;
    const deliveryCost = accounts.get('Delivery Cost')!;

    await createOrderOn(user.organizationId, branch.id, user.id, 1, { itemId: item.id, quantity: 1, type: 'DELIVERY' });
    await createOrderOn(user.organizationId, branch.id, user.id, 0, { itemId: item.id, quantity: 2, type: 'DELIVERY' });
    // Both well under the default 1000 expenseMinAmount floor.
    await postEntry(user.organizationId, user.id, localMidday(1), [{ accountId: deliveryCost.id, debit: '30.00' }, { accountId: cash.id, credit: '30.00' }]);
    await postEntry(user.organizationId, user.id, localMidday(0), [{ accountId: deliveryCost.id, debit: '90.00' }, { accountId: cash.id, credit: '90.00' }]);

    const result = await InsightService.generateInsights(user.organizationId, TODAY);
    expect(result.insights.find((i) => i.id === 'channel-divergence-delivery')).toBeUndefined();
    expect(result.insights.find((i) => i.id === 'expense-trend-5040')).toBeUndefined();
  });
});

describe('InsightService.generateInsights — customer behavior', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('surfaces an improving repeat-rate insight when today is all repeat customers and yesterday was all new', async () => {
    const { user, branch, item } = await setupFixture('cust-a');
    const repeatCustomer = await CustomerService.create(user.organizationId, { firstName: 'Repeat', lastName: 'Customer' }, user.id);
    const newCustomer = await CustomerService.create(user.organizationId, { firstName: 'New', lastName: 'Customer' }, user.id);

    // Repeat customer's history-establishing order, well before "yesterday".
    const ancientOrder = await createOrderOn(user.organizationId, branch.id, user.id, 0, { itemId: item.id, quantity: 1, customerId: repeatCustomer.id });
    await prisma.order.update({ where: { id: ancientOrder.id }, data: { createdAt: new Date('2020-01-01T00:00:00.000Z') } });
    // Repeat customer orders again today -> repeat, this period.
    await createOrderOn(user.organizationId, branch.id, user.id, 0, { itemId: item.id, quantity: 1, customerId: repeatCustomer.id });
    // New customer's only order is yesterday -> not repeat, that period.
    await createOrderOn(user.organizationId, branch.id, user.id, 1, { itemId: item.id, quantity: 1, customerId: newCustomer.id });

    const result = await InsightService.generateInsights(user.organizationId, TODAY);
    const customer = result.insights.find((i) => i.id === 'customer-repeat-rate');
    expect(customer).toBeDefined();
    expect(customer?.severity).toBe('OPPORTUNITY');
    const repeatMetric = customer?.metrics.find((m) => m.label === 'Repeat rate');
    expect(repeatMetric?.value).toBe('100.0%');
    expect(repeatMetric?.previousValue).toBe('0.0%');
  });
});

describe('InsightService.generateInsights — product category performance', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('surfaces a category-level insight when a category swings well past the default threshold', async () => {
    const { user, branch, item } = await setupFixture('prod-a');
    await createOrderOn(user.organizationId, branch.id, user.id, 1, { itemId: item.id, quantity: 3 }); // yesterday: 450
    await createOrderOn(user.organizationId, branch.id, user.id, 0, { itemId: item.id, quantity: 10 }); // today: 1500, +233%

    const result = await InsightService.generateInsights(user.organizationId, TODAY);
    const product = result.insights.find((i) => i.id.startsWith('product-category-'));
    expect(product).toBeDefined();
    expect(product?.severity).toBe('OPPORTUNITY');
    expect(product?.title).toContain('Mains');
  });
});

describe('InsightService.generateInsights — inventory trends', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('surfaces a waste-cost trend insight and a critical-stock insight together', async () => {
    const { user, branch } = await setupFixture('inv-a');
    const unit = await InventoryService.createUnit(user.organizationId, { name: 'Kilogram', abbreviation: 'kg' }, user.id);
    const ingredient = await InventoryService.createIngredient(user.organizationId, { name: 'Flour', stockUnitId: unit.id, costPerUnit: '10.00' }, user.id);
    const invItem = await InventoryService.createInventoryItem(
      user.organizationId,
      branch.id,
      { ingredientId: ingredient.id, initialQuantity: '2', reorderPoint: '10', criticalPoint: '5' },
      user.id,
    );

    const yesterdayWaste = await InventoryService.recordWaste(user.organizationId, branch.id, invItem.id, { quantity: '1', reason: 'Spoilage' }, user.id);
    await prisma.wasteRecord.update({ where: { id: yesterdayWaste.id }, data: { createdAt: localMidday(1) } }); // 1 x 10 = 10
    const todayWaste = await InventoryService.recordWaste(user.organizationId, branch.id, invItem.id, { quantity: '3', reason: 'Spoilage' }, user.id);
    await prisma.wasteRecord.update({ where: { id: todayWaste.id }, data: { createdAt: localMidday(0) } }); // 3 x 10 = 30, +200%

    const result = await InsightService.generateInsights(user.organizationId, TODAY);

    const waste = result.insights.find((i) => i.id === 'inventory-waste-trend');
    expect(waste).toBeDefined();
    expect(waste?.severity).toBe('ATTENTION');

    // quantityOnHand (2) is at/below criticalPoint (5) from creation.
    const critical = result.insights.find((i) => i.id === 'inventory-critical-stock');
    expect(critical).toBeDefined();
    expect(critical?.severity).toBe('ATTENTION');
    expect(critical?.metrics.find((m) => m.label === 'Critical stock items')?.value).toBe('1');
  });
});

describe('InsightService.generateInsights — demand pattern and threshold configurability', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('always surfaces an informational demand-pattern insight when there is any order activity', async () => {
    const { user, branch, item } = await setupFixture('demand-a');
    await createOrderOn(user.organizationId, branch.id, user.id, 0, { itemId: item.id, quantity: 1 });

    const result = await InsightService.generateInsights(user.organizationId, TODAY);
    const demand = result.insights.find((i) => i.id === 'demand-pattern');
    expect(demand).toBeDefined();
    expect(demand?.severity).toBe('INFO');
  });

  it("master spec §37's 'all rules must be configurable': a raised threshold suppresses an insight the default would have surfaced", async () => {
    const { user, branch, item } = await setupFixture('config-a');
    await createOrderOn(user.organizationId, branch.id, user.id, 1, { itemId: item.id, quantity: 2 }); // yesterday: 300
    await createOrderOn(user.organizationId, branch.id, user.id, 0, { itemId: item.id, quantity: 3 }); // today: 450, +50%

    const atDefault = await InsightService.generateInsights(user.organizationId, TODAY);
    expect(atDefault.insights.find((i) => i.id === 'sales-trend')).toBeDefined(); // +50% >= default 10%

    await prisma.organization.update({
      where: { id: user.organizationId },
      data: { aiSettings: { insightThresholds: { salesChangePct: 200 } } },
    });

    const atOverride = await InsightService.generateInsights(user.organizationId, TODAY);
    expect(atOverride.insights.find((i) => i.id === 'sales-trend')).toBeUndefined(); // +50% < overridden 200%
  });

  it('rejects a branchId that does not belong to the organization', async () => {
    const { user } = await setupFixture('config-b');
    await expect(InsightService.generateInsights(user.organizationId, { ...TODAY, branchId: 'does-not-exist' })).rejects.toThrow();
  });
});

describe('InsightService.forecastRevenue', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns 'insufficient_data' for a single-bucket range rather than projecting from too little history", async () => {
    const { user, branch, item } = await setupFixture('forecast-a');
    await createOrderOn(user.organizationId, branch.id, user.id, 0, { itemId: item.id, quantity: 1 });

    const forecast = await InsightService.forecastRevenue(user.organizationId, { ...TODAY, periodsAhead: 1 });
    expect(forecast.status).toBe('insufficient_data');
    expect(forecast.forecast).toEqual([]);
  });

  it('projects the next bucket along an increasing trend, fully disclosed as a heuristic', async () => {
    const { user, branch, item } = await setupFixture('forecast-b');
    // Increasing daily revenue at day -4, -2, and 0 (150, 300, 450) — the
    // two days in between are zero-filled buckets (enumerateBuckets fills
    // every day in range, not just days with orders), so the 5-bucket
    // series is [150, 0, 300, 0, 450]. Not perfectly linear point-to-point,
    // but its overall least-squares slope is unambiguously positive, which
    // is all this test needs: the projection should continue upward, and
    // must never go negative regardless of the zero buckets pulling it down.
    await createOrderOn(user.organizationId, branch.id, user.id, 4, { itemId: item.id, quantity: 1 }); // 150 (day -4)
    await createOrderOn(user.organizationId, branch.id, user.id, 2, { itemId: item.id, quantity: 2 }); // 300 (day -2)
    await createOrderOn(user.organizationId, branch.id, user.id, 0, { itemId: item.id, quantity: 3 }); // 450 (day 0, today)

    const customQuery = {
      preset: 'custom' as const,
      startDate: localDateKey(4),
      endDate: localDateKey(0),
      periodsAhead: 2,
    };
    const forecast = await InsightService.forecastRevenue(user.organizationId, customQuery);
    expect(forecast.status).toBe('ok');
    expect(forecast.method).toBe('linear-regression-over-trailing-buckets');
    expect(forecast.history.length).toBe(5);
    expect(forecast.forecast.length).toBe(2);
    for (const bucket of forecast.forecast) {
      expect(Number(bucket.projectedRevenue)).toBeGreaterThanOrEqual(0); // never negative, even for a declining series
    }
    // Exact least-squares fit over [150, 0, 300, 0, 450] (x = 0..4): slope
    // 60, intercept 60 -> x=5 projects to 360.00, x=6 to 420.00. Asserted
    // exactly (not just "> 0") since every input here is a round number
    // with no rounding error anywhere in the computation.
    expect(forecast.forecast[0]?.projectedRevenue).toBe('360.00');
    expect(forecast.forecast[1]?.projectedRevenue).toBe('420.00');
    expect(forecast.disclaimer.length).toBeGreaterThan(0);
    expect(forecast.dataSources.length).toBeGreaterThan(0);
  });
});
