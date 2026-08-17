import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { AccountingService } from '@/services/accounting/AccountingService';
import { ReportingService } from '@/services/reporting/ReportingService';
import { resetDatabase } from '../../helpers/db';
import type { CreateJournalEntryInput } from '@/lib/validation/accounting';

async function setupFixture(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Reporting Test ${suffix}`,
    organizationEmail: `reporting-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@reporting-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  const list = await AccountingService.listAccounts(user.organizationId, {});
  // Explicit generic + populate-by-loop — same TS inference gap documented
  // throughout Phase 10/11 for `new Map(x.map(...))` against Prisma results.
  const byName = new Map<string, (typeof list)[number]>();
  for (const a of list) byName.set(a.name, a);
  return { user, accounts: byName };
}

type Line = { accountId: string; debit?: string; credit?: string };

/** Creates and immediately posts a balanced journal entry, bypassing zod (same convention as accounting-service.test.ts). */
async function postEntry(organizationId: string, actorUserId: string, entryDate: string, branchId: string | undefined, lines: Line[], description = 'Test entry') {
  const input: CreateJournalEntryInput = {
    entryDate,
    description,
    branchId,
    lines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit ?? '0', credit: l.credit ?? '0' })),
  };
  const created = await AccountingService.createJournalEntry(organizationId, input, actorUserId);
  return AccountingService.postJournalEntry(organizationId, created.id, actorUserId);
}

describe('ReportingService.generateIncomeStatement', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('computes Revenue - COGS = Gross Profit and Gross Profit - Operating Expenses = Net Profit, excluding entries outside the date range', async () => {
    const { user, accounts } = await setupFixture('is-a');
    const cash = accounts.get('Cash')!;
    const revenue = accounts.get('Dine-in Revenue')!;
    const cogs = accounts.get('Food Cost')!;
    const inventory = accounts.get('Inventory')!;
    const rent = accounts.get('Rent')!;

    await postEntry(user.organizationId, user.id, '2026-08-05T02:00:00.000Z', undefined, [
      { accountId: cash.id, debit: '1000.00' }, { accountId: revenue.id, credit: '1000.00' },
    ], 'Sale');
    await postEntry(user.organizationId, user.id, '2026-08-05T02:05:00.000Z', undefined, [
      { accountId: cogs.id, debit: '400.00' }, { accountId: inventory.id, credit: '400.00' },
    ], 'COGS for sale');
    await postEntry(user.organizationId, user.id, '2026-08-06T02:00:00.000Z', undefined, [
      { accountId: rent.id, debit: '100.00' }, { accountId: cash.id, credit: '100.00' },
    ], 'Rent');
    // Outside the queried range — must not affect totals.
    await postEntry(user.organizationId, user.id, '2026-07-01T02:00:00.000Z', undefined, [
      { accountId: cash.id, debit: '5000.00' }, { accountId: revenue.id, credit: '5000.00' },
    ], 'July sale (excluded)');

    const report = await ReportingService.generateIncomeStatement(user.organizationId, {
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2026-08-31T23:59:59.999Z'),
    });

    expect(report.revenue.total.toString()).toBe('1000.00');
    expect(report.cogs.total.toString()).toBe('400.00');
    expect(report.grossProfit.toString()).toBe('600.00');
    expect(report.operatingExpenses.total.toString()).toBe('100.00');
    expect(report.netProfit.toString()).toBe('500.00');
  });

  it('scopes to a single branch when branchId is given', async () => {
    const { user, accounts } = await setupFixture('is-b');
    const branchA = await BranchService.create(user.organizationId, { name: 'Branch A', timezone: 'Asia/Manila' }, user.id);
    const branchB = await BranchService.create(user.organizationId, { name: 'Branch B', timezone: 'Asia/Manila' }, user.id);
    const cash = accounts.get('Cash')!;
    const revenue = accounts.get('Dine-in Revenue')!;

    await postEntry(user.organizationId, user.id, '2026-08-05T02:00:00.000Z', branchA.id, [
      { accountId: cash.id, debit: '300.00' }, { accountId: revenue.id, credit: '300.00' },
    ]);
    await postEntry(user.organizationId, user.id, '2026-08-05T02:00:00.000Z', branchB.id, [
      { accountId: cash.id, debit: '700.00' }, { accountId: revenue.id, credit: '700.00' },
    ]);

    const range = { startDate: new Date('2026-08-01T00:00:00.000Z'), endDate: new Date('2026-08-31T23:59:59.999Z') };
    const reportA = await ReportingService.generateIncomeStatement(user.organizationId, { ...range, branchId: branchA.id });
    expect(reportA.revenue.total.toString()).toBe('300.00');
    const reportAll = await ReportingService.generateIncomeStatement(user.organizationId, range);
    expect(reportAll.revenue.total.toString()).toBe('1000.00');
  });
});

describe('ReportingService.generateBalanceSheet — reconciliation', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('Assets = Liabilities + Equity(recorded) + NetIncomeToDate holds for an arbitrary mix of posted transactions', async () => {
    const { user, accounts } = await setupFixture('bs-a');
    const cash = accounts.get('Cash')!;
    const bank = accounts.get('Bank')!;
    const ar = accounts.get('Accounts Receivable')!;
    const ap = accounts.get('Accounts Payable')!;
    const equity = accounts.get("Owner's Equity")!;
    const revenue = accounts.get('Dine-in Revenue')!;
    const cogs = accounts.get('Food Cost')!;
    const inventory = accounts.get('Inventory')!;
    const rent = accounts.get('Rent')!;

    await postEntry(user.organizationId, user.id, '2026-08-01T00:00:00.000Z', undefined, [
      { accountId: bank.id, debit: '500000.00' }, { accountId: equity.id, credit: '500000.00' },
    ], 'Owner capital contribution');
    await postEntry(user.organizationId, user.id, '2026-08-05T00:00:00.000Z', undefined, [
      { accountId: cash.id, debit: '700.00' }, { accountId: ar.id, debit: '300.00' }, { accountId: revenue.id, credit: '1000.00' },
    ], 'Cash/AR split sale');
    await postEntry(user.organizationId, user.id, '2026-08-05T00:05:00.000Z', undefined, [
      { accountId: cogs.id, debit: '400.00' }, { accountId: inventory.id, credit: '400.00' },
    ], 'COGS');
    await postEntry(user.organizationId, user.id, '2026-08-06T00:00:00.000Z', undefined, [
      { accountId: rent.id, debit: '10000.00' }, { accountId: ap.id, credit: '10000.00' },
    ], 'Rent on account');

    const balanceSheet = await ReportingService.generateBalanceSheet(user.organizationId, { asOfDate: new Date('2026-08-31T23:59:59.999Z') });
    expect(balanceSheet.isBalanced).toBe(true);
    expect(balanceSheet.assets.total.toString()).toBe(balanceSheet.totalLiabilitiesAndEquity.toString());
    // Net income to date = 1000 revenue - 400 COGS - 10000 rent = -9400 (a loss).
    expect(balanceSheet.equity.netIncomeToDate.toString()).toBe('-9400.00');
  });

  it('excludes DRAFT entries from the balance sheet', async () => {
    const { user, accounts } = await setupFixture('bs-b');
    const cash = accounts.get('Cash')!;
    const equity = accounts.get("Owner's Equity")!;
    // Create but do NOT post.
    await AccountingService.createJournalEntry(user.organizationId, {
      entryDate: '2026-08-05T00:00:00.000Z',
      description: 'Unposted draft',
      lines: [{ accountId: cash.id, debit: '99999.00', credit: '0' }, { accountId: equity.id, debit: '0', credit: '99999.00' }],
    }, user.id);

    const balanceSheet = await ReportingService.generateBalanceSheet(user.organizationId, { asOfDate: new Date() });
    expect(balanceSheet.assets.total.toString()).toBe('0.00');
    expect(balanceSheet.isBalanced).toBe(true);
  });

  it('a branch-scoped balance sheet also balances, since every journal entry is single-branch (never split across branches)', async () => {
    const { user, accounts } = await setupFixture('bs-c');
    const branchA = await BranchService.create(user.organizationId, { name: 'Branch A', timezone: 'Asia/Manila' }, user.id);
    const cash = accounts.get('Cash')!;
    const revenue = accounts.get('Dine-in Revenue')!;
    await postEntry(user.organizationId, user.id, '2026-08-05T00:00:00.000Z', branchA.id, [
      { accountId: cash.id, debit: '250.00' }, { accountId: revenue.id, credit: '250.00' },
    ]);

    const balanceSheet = await ReportingService.generateBalanceSheet(user.organizationId, { asOfDate: new Date(), branchId: branchA.id });
    expect(balanceSheet.isBalanced).toBe(true);
    expect(balanceSheet.assets.total.toString()).toBe('250.00');
  });
});

describe('ReportingService.generateCashFlow — direct method reconciliation', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('classifies contra accounts into Operating/Investing/Financing and reconciles net cash flow to the change in cash balance', async () => {
    const { user, accounts } = await setupFixture('cf-a');
    const cash = accounts.get('Cash')!;
    const bank = accounts.get('Bank')!;
    const ar = accounts.get('Accounts Receivable')!;
    const revenue = accounts.get('Dine-in Revenue')!;
    const rent = accounts.get('Rent')!;
    const equipment = accounts.get('Equipment')!;
    const loans = accounts.get('Loans')!;

    // Aug 1 — revenue in cash (Operating inflow); this one sits outside the
    // narrower Aug 5+ range used below, so it also exercises beginningCash.
    await postEntry(user.organizationId, user.id, '2026-08-01T00:00:00.000Z', undefined, [
      { accountId: cash.id, debit: '1000.00' }, { accountId: revenue.id, credit: '1000.00' },
    ], 'Cash sale');

    // Aug 10 — the rest of the mix.
    await postEntry(user.organizationId, user.id, '2026-08-10T00:00:00.000Z', undefined, [
      { accountId: rent.id, debit: '100.00' }, { accountId: bank.id, credit: '100.00' },
    ], 'Rent via bank'); // Operating outflow
    await postEntry(user.organizationId, user.id, '2026-08-10T00:05:00.000Z', undefined, [
      { accountId: equipment.id, debit: '2000.00' }, { accountId: bank.id, credit: '2000.00' },
    ], 'Equipment purchase'); // Investing outflow
    await postEntry(user.organizationId, user.id, '2026-08-10T00:10:00.000Z', undefined, [
      { accountId: bank.id, debit: '5000.00' }, { accountId: loans.id, credit: '5000.00' },
    ], 'Loan proceeds'); // Financing inflow
    await postEntry(user.organizationId, user.id, '2026-08-10T00:15:00.000Z', undefined, [
      { accountId: ar.id, debit: '1500.00' }, { accountId: revenue.id, credit: '1500.00' },
    ], 'Sale on account (no cash touched)'); // Should not appear at all.
    await postEntry(user.organizationId, user.id, '2026-08-10T00:20:00.000Z', undefined, [
      { accountId: bank.id, debit: '300.00' }, { accountId: cash.id, credit: '300.00' },
    ], 'Register deposit to bank'); // Cash-to-cash transfer — nets to zero.

    // A custom account with no cashFlowCategory — its cash impact must land
    // in `unclassifiedActivities`, never silently disappear.
    const clearing = await AccountingService.createAccount(user.organizationId, { code: '9000', name: 'Suspense', type: 'LIABILITY' }, user.id);
    await AccountingService.updateAccount(user.organizationId, clearing.id, { cashFlowCategory: null }, user.id);
    await postEntry(user.organizationId, user.id, '2026-08-10T00:25:00.000Z', undefined, [
      { accountId: cash.id, debit: '50.00' }, { accountId: clearing.id, credit: '50.00' },
    ], 'Unclassified cash movement');

    const fullRange = await ReportingService.generateCashFlow(user.organizationId, {
      startDate: new Date('2026-08-01T00:00:00.000Z'), endDate: new Date('2026-08-31T23:59:59.999Z'),
    });
    expect(fullRange.operatingActivities.toString()).toBe('900.00'); // +1000 revenue - 100 rent
    expect(fullRange.investingActivities.toString()).toBe('-2000.00');
    expect(fullRange.financingActivities.toString()).toBe('5000.00');
    expect(fullRange.unclassifiedActivities.toString()).toBe('50.00');
    expect(fullRange.netCashFlow.toString()).toBe('3950.00');
    expect(fullRange.beginningCash.toString()).toBe('0.00');
    expect(fullRange.endingCash.toString()).toBe('3950.00');
    expect(fullRange.isReconciled).toBe(true);

    // Narrower range excludes the Aug 1 cash sale from the category totals,
    // but it must still show up correctly as beginningCash.
    const narrowRange = await ReportingService.generateCashFlow(user.organizationId, {
      startDate: new Date('2026-08-05T00:00:00.000Z'), endDate: new Date('2026-08-31T23:59:59.999Z'),
    });
    expect(narrowRange.operatingActivities.toString()).toBe('-100.00'); // rent only
    expect(narrowRange.beginningCash.toString()).toBe('1000.00'); // the Aug 1 sale
    expect(narrowRange.endingCash.toString()).toBe('3950.00');
    expect(narrowRange.netCashFlow.toString()).toBe(narrowRange.endingCash.minus(narrowRange.beginningCash).toString());
    expect(narrowRange.isReconciled).toBe(true);
  });
});

describe('ReportingService.getFinancialDashboard', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("reports today's figures and current outstanding balances, scoped to a branch when given", async () => {
    const { user, accounts } = await setupFixture('dash-a');
    const branchA = await BranchService.create(user.organizationId, { name: 'Branch A', timezone: 'Asia/Manila' }, user.id);
    const branchB = await BranchService.create(user.organizationId, { name: 'Branch B', timezone: 'Asia/Manila' }, user.id);
    const cash = accounts.get('Cash')!;
    const ar = accounts.get('Accounts Receivable')!;
    const ap = accounts.get('Accounts Payable')!;
    const inventory = accounts.get('Inventory')!;
    const revenue = accounts.get('Dine-in Revenue')!;
    const cogs = accounts.get('Food Cost')!;
    const rent = accounts.get('Rent')!;

    const now = new Date().toISOString();
    await postEntry(user.organizationId, user.id, now, branchA.id, [
      { accountId: cash.id, debit: '2000.00' }, { accountId: revenue.id, credit: '2000.00' },
    ], "Today's sale — branch A");
    await postEntry(user.organizationId, user.id, now, branchA.id, [
      { accountId: cogs.id, debit: '800.00' }, { accountId: inventory.id, credit: '800.00' },
    ], "Today's COGS — branch A");
    await postEntry(user.organizationId, user.id, now, branchA.id, [
      { accountId: rent.id, debit: '150.00' }, { accountId: ap.id, credit: '150.00' },
    ], "Today's rent on account — branch A");
    await postEntry(user.organizationId, user.id, now, branchA.id, [
      { accountId: ar.id, debit: '500.00' }, { accountId: revenue.id, credit: '500.00' },
    ], "Today's sale on account — branch A");
    // A different branch's sale must not leak into branch A's dashboard.
    await postEntry(user.organizationId, user.id, now, branchB.id, [
      { accountId: cash.id, debit: '9999.00' }, { accountId: revenue.id, credit: '9999.00' },
    ], "Today's sale — branch B");

    const dashboard = await ReportingService.getFinancialDashboard(user.organizationId, { branchId: branchA.id });
    expect(dashboard.todayRevenue.toString()).toBe('2500.00'); // 2000 cash + 500 on account
    expect(dashboard.todayExpenses.toString()).toBe('800.00'); // COGS
    expect(dashboard.grossProfit.toString()).toBe('1700.00');
    expect(dashboard.todayOperatingExpenses.toString()).toBe('150.00');
    expect(dashboard.netProfit.toString()).toBe('1550.00');
    expect(dashboard.cashPosition.toString()).toBe('2000.00');
    expect(dashboard.outstandingReceivables.toString()).toBe('500.00');
    expect(dashboard.outstandingPayables.toString()).toBe('150.00');
    expect(dashboard.inventoryValue.toString()).toBe('-800.00');
  });
});
