import 'server-only';
import { Prisma } from '@prisma/client';
import type { AccountType, CashFlowCategory } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError } from '@/lib/utils/api-error';
import { resolveDateRangePreset, type DateRangePreset } from '@/lib/utils/timezone';

/**
 * Phase 11 — Financial Reporting. Master spec §35: "Reports must be
 * generated from the accounting ledger. Do not calculate financial
 * statements from UI aggregates." Every method in this class queries
 * posted `JournalEntry`/`JournalEntryLine` rows (joined to their
 * `ChartOfAccount`) directly — nothing here reads `Order`, `Reservation`,
 * `CateringPayment`, or any other business-event table. Those tables feed
 * the ledger via AccountingService's financial transaction engine
 * (Phase 10); this service only ever reads what already landed there.
 *
 * Trial balance and single-account balances were already built in Phase
 * 10 (AccountingService.generateTrialBalance / getAccountBalance) — this
 * phase's own build list (master spec's "PHASE 11 — FINANCIAL REPORTING"
 * section) also names those two, but they're reused as-is, not
 * reimplemented, per that scope call.
 *
 * DRAFT and REVERSED entries are excluded from every report here (only
 * `status: 'POSTED'` lines are read) — same convention as
 * AccountingService.getAccountBalance/generateTrialBalance.
 *
 * Cash Flow's classification design (see generateCashFlow below) relies on
 * two Phase 11 additions to ChartOfAccount: `isCashEquivalent` (marks
 * Cash/Bank) and `cashFlowCategory` (Operating/Investing/Financing for the
 * contra side of a cash movement) — see schema.prisma's comments on those
 * fields for the full reasoning.
 */

type AccountLineTotal = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  amount: Prisma.Decimal;
};

const ZERO = new Prisma.Decimal(0);

function sumAmounts(rows: ReadonlyArray<{ amount: Prisma.Decimal }>): Prisma.Decimal {
  return rows.reduce((sum, r) => sum.plus(r.amount), ZERO);
}

export class ReportingService {
  private static async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }

  /**
   * Resolves a master-spec-§54 report-filter preset (plus, for "custom", a
   * validated start/end pair from lib/validation/reporting.ts) into a
   * concrete date range, evaluated in the organization's own timezone —
   * kept here rather than in the API route layer so every report resolves
   * "today"/"this month"/etc. identically regardless of caller.
   */
  static async resolveReportDateRange(
    organizationId: string,
    query: { preset: DateRangePreset; startDate?: string; endDate?: string },
  ): Promise<{ startDate: Date; endDate: Date }> {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } });
    return resolveDateRangePreset(
      query.preset,
      organization.timezone,
      new Date(),
      query.startDate ? new Date(query.startDate) : undefined,
      query.endDate ? new Date(query.endDate) : undefined,
    );
  }

  /**
   * Every posted JournalEntryLine whose account is one of `types`, within
   * `[range.startDate, range.endDate]` (startDate omitted = from
   * inception — same "no lower bound" convention as
   * AccountingService.getAccountBalance's asOfDate), summed per account
   * using each account's own normalBalance side (so the returned amount is
   * always "how much this account grew in the normal direction", never a
   * raw debit/credit total an income-statement/balance-sheet caller would
   * have to re-sign itself).
   */
  private static async aggregateLinesByAccountType(
    organizationId: string,
    types: readonly AccountType[],
    range: { startDate?: Date; endDate: Date },
    branchId?: string,
  ): Promise<AccountLineTotal[]> {
    const lines = await prisma.journalEntryLine.findMany({
      where: {
        account: { organizationId, type: { in: types as AccountType[] } },
        journalEntry: {
          organizationId,
          status: 'POSTED',
          entryDate: { ...(range.startDate ? { gte: range.startDate } : {}), lte: range.endDate },
          ...(branchId ? { branchId } : {}),
        },
      },
      include: { account: true },
    });

    // Explicit generic + populate-by-loop, not `new Map(lines.map(...))` —
    // the same TS inference gap documented in CLAUDE.md → Known Issues
    // (a Map built straight from a Prisma-typed .map() callback collapses
    // its value type to `{}` under this project's strict +
    // noUncheckedIndexedAccess settings).
    const byAccount = new Map<string, AccountLineTotal>();
    for (const line of lines) {
      const account = line.account;
      const signedAmount = account.normalBalance === 'DEBIT' ? line.debit.minus(line.credit) : line.credit.minus(line.debit);
      const existing = byAccount.get(account.id);
      if (existing) {
        existing.amount = existing.amount.plus(signedAmount);
      } else {
        byAccount.set(account.id, { accountId: account.id, code: account.code, name: account.name, type: account.type, amount: signedAmount });
      }
    }
    return Array.from(byAccount.values()).sort((a, b) => a.code.localeCompare(b.code));
  }

  /**
   * Cumulative Revenue − COGS − Expense from inception through `endDate` —
   * the "unclosed net income" a Balance Sheet needs folded into Equity
   * (see generateBalanceSheet). Factored out so both callers share one
   * implementation rather than risking the two figures drifting apart.
   */
  private static async computeNetIncomeToDate(organizationId: string, endDate: Date, branchId?: string): Promise<Prisma.Decimal> {
    const rows = await this.aggregateLinesByAccountType(organizationId, ['REVENUE', 'COGS', 'EXPENSE'], { endDate }, branchId);
    const revenue = sumAmounts(rows.filter((r) => r.type === 'REVENUE'));
    const cogs = sumAmounts(rows.filter((r) => r.type === 'COGS'));
    const expense = sumAmounts(rows.filter((r) => r.type === 'EXPENSE'));
    return revenue.minus(cogs).minus(expense);
  }

  // ===========================================================================
  // Income Statement (master spec §35)
  // ===========================================================================

  static async generateIncomeStatement(organizationId: string, params: { startDate: Date; endDate: Date; branchId?: string }) {
    if (params.branchId) await this.assertBranchInOrg(organizationId, params.branchId);

    const rows = await this.aggregateLinesByAccountType(
      organizationId,
      ['REVENUE', 'COGS', 'EXPENSE'],
      { startDate: params.startDate, endDate: params.endDate },
      params.branchId,
    );
    const revenueAccounts = rows.filter((r) => r.type === 'REVENUE');
    const cogsAccounts = rows.filter((r) => r.type === 'COGS');
    const expenseAccounts = rows.filter((r) => r.type === 'EXPENSE');

    const totalRevenue = sumAmounts(revenueAccounts);
    const totalCogs = sumAmounts(cogsAccounts);
    const grossProfit = totalRevenue.minus(totalCogs);
    const totalOperatingExpenses = sumAmounts(expenseAccounts);
    const netProfit = grossProfit.minus(totalOperatingExpenses);

    return {
      startDate: params.startDate,
      endDate: params.endDate,
      branchId: params.branchId ?? null,
      revenue: { accounts: revenueAccounts, total: totalRevenue },
      cogs: { accounts: cogsAccounts, total: totalCogs },
      grossProfit,
      operatingExpenses: { accounts: expenseAccounts, total: totalOperatingExpenses },
      netProfit,
    };
  }

  // ===========================================================================
  // Balance Sheet (master spec §35)
  // ===========================================================================

  /**
   * Assets / Liabilities / Equity as of a point in time. There is no
   * period-closing journal entry in this build (AccountingPeriod.close, in
   * Phase 10, only blocks further postings into a closed period — it does
   * not zero Revenue/COGS/Expense account balances into Retained
   * Earnings), so Revenue/COGS/Expense balances simply accumulate forever
   * on the ledger. That means a Balance Sheet computed from only the
   * recorded ASSET/LIABILITY/EQUITY account balances would NOT balance
   * against Assets unless the current, still-unclosed net income is folded
   * into Equity — this is exactly what any live system without a
   * year-end close does, and it's what makes the invariant
   * `Assets = Liabilities + Equity` a genuine double-entry guarantee
   * rather than an approximation: every posted entry is balanced, so
   * summing debit-minus-credit (or credit-minus-debit) across the *entire*
   * ledger through `asOfDate` is always exactly zero, and that sum is
   * precisely `Assets − Liabilities − Equity(recorded) − NetIncomeToDate`
   * once each account's normal-balance sign is applied. See
   * tests/integration/reporting/reporting-service.test.ts for the proof
   * against arbitrary transaction mixes (master spec Phase 11's "Verify
   * reconciliation" instruction).
   */
  static async generateBalanceSheet(organizationId: string, params: { asOfDate: Date; branchId?: string }) {
    if (params.branchId) await this.assertBranchInOrg(organizationId, params.branchId);

    const rows = await this.aggregateLinesByAccountType(
      organizationId,
      ['ASSET', 'LIABILITY', 'EQUITY'],
      { endDate: params.asOfDate },
      params.branchId,
    );
    const assetAccounts = rows.filter((r) => r.type === 'ASSET');
    const liabilityAccounts = rows.filter((r) => r.type === 'LIABILITY');
    const equityAccounts = rows.filter((r) => r.type === 'EQUITY');

    const totalAssets = sumAmounts(assetAccounts);
    const totalLiabilities = sumAmounts(liabilityAccounts);
    const recordedEquity = sumAmounts(equityAccounts);
    const netIncomeToDate = await this.computeNetIncomeToDate(organizationId, params.asOfDate, params.branchId);
    const totalEquity = recordedEquity.plus(netIncomeToDate);

    return {
      asOfDate: params.asOfDate,
      branchId: params.branchId ?? null,
      assets: { accounts: assetAccounts, total: totalAssets },
      liabilities: { accounts: liabilityAccounts, total: totalLiabilities },
      equity: { accounts: equityAccounts, recordedTotal: recordedEquity, netIncomeToDate, total: totalEquity },
      totalLiabilitiesAndEquity: totalLiabilities.plus(totalEquity),
      isBalanced: totalAssets.equals(totalLiabilities.plus(totalEquity)),
    };
  }

  // ===========================================================================
  // Cash Flow (master spec §35) — direct method
  // ===========================================================================

  /**
   * Walks every POSTED journal entry in the date range that touches at
   * least one `isCashEquivalent` account, and attributes that entry's net
   * cash movement to Operating/Investing/Financing by looking at the
   * *other* (non-cash) line(s) in the same entry.
   *
   * Why this is exact, not a heuristic: every posted entry balances
   * (sum of all its lines' debit-minus-credit is zero — enforced by
   * AccountingService.assertBalanced at posting time). So for any entry
   * touching cash, `sum(non-cash lines' credit-minus-debit)` is
   * *identically equal* to that entry's net cash inflow/outflow — there is
   * no need to separately read the cash line at all. Grouping the
   * non-cash lines by their account's `cashFlowCategory` before summing
   * therefore partitions the entry's exact cash impact across categories
   * with no rounding, no proportional guessing, and no double-counting.
   * A non-cash line whose account has no `cashFlowCategory` set (a custom
   * account an org added without classifying it) falls into `unclassified`
   * rather than being silently dropped — see the class-level "no silent
   * caps" precedent already established by the trial balance's own
   * isBalanced check.
   *
   * A journal entry that moves money between two cash-equivalent accounts
   * (e.g. a register-to-bank deposit) nets to zero across all lines that
   * are skipped as "cash", contributing nothing to any category — which is
   * correct: total cash-on-hand doesn't change, so the direct method
   * shouldn't report an "activity" for it.
   *
   * Reconciliation: `netCashFlow` (operating + investing + financing +
   * unclassified) is asserted, in tests, to equal
   * `endingCash − beginningCash` computed independently via
   * `aggregateLinesByAccountType` over just the cash-equivalent accounts —
   * master spec Phase 11's explicit "Verify reconciliation" instruction.
   */
  static async generateCashFlow(organizationId: string, params: { startDate: Date; endDate: Date; branchId?: string }) {
    if (params.branchId) await this.assertBranchInOrg(organizationId, params.branchId);

    const cashAccounts = await prisma.chartOfAccount.findMany({ where: { organizationId, isCashEquivalent: true } });
    const cashAccountIds = new Set(cashAccounts.map((a) => a.id));

    const totals: Record<CashFlowCategory, Prisma.Decimal> = { OPERATING: ZERO, INVESTING: ZERO, FINANCING: ZERO };
    let unclassified = ZERO;

    if (cashAccountIds.size > 0) {
      const entries = await prisma.journalEntry.findMany({
        where: {
          organizationId,
          status: 'POSTED',
          entryDate: { gte: params.startDate, lte: params.endDate },
          ...(params.branchId ? { branchId: params.branchId } : {}),
          lines: { some: { accountId: { in: Array.from(cashAccountIds) } } },
        },
        include: { lines: { include: { account: true } } },
      });

      for (const entry of entries) {
        for (const line of entry.lines) {
          if (cashAccountIds.has(line.accountId)) continue; // the cash side itself — see file header.
          const impact = line.credit.minus(line.debit);
          const category = line.account.cashFlowCategory;
          if (category) totals[category] = totals[category].plus(impact);
          else unclassified = unclassified.plus(impact);
        }
      }
    }

    const netCashFlow = totals.OPERATING.plus(totals.INVESTING).plus(totals.FINANCING).plus(unclassified);

    const cashBalanceAsOf = async (asOf: Date) => {
      if (cashAccountIds.size === 0) return ZERO;
      const rows = await this.aggregateLinesByAccountType(organizationId, ['ASSET'], { endDate: asOf }, params.branchId);
      return sumAmounts(rows.filter((r) => cashAccountIds.has(r.accountId)));
    };
    const beginningCash = await cashBalanceAsOf(new Date(params.startDate.getTime() - 1));
    const endingCash = await cashBalanceAsOf(params.endDate);

    return {
      startDate: params.startDate,
      endDate: params.endDate,
      branchId: params.branchId ?? null,
      operatingActivities: totals.OPERATING,
      investingActivities: totals.INVESTING,
      financingActivities: totals.FINANCING,
      unclassifiedActivities: unclassified,
      netCashFlow,
      beginningCash,
      endingCash,
      isReconciled: netCashFlow.equals(endingCash.minus(beginningCash)),
    };
  }

  // ===========================================================================
  // Financial dashboard (master spec §33 / §53 — the financial-figures
  // subset; operational counts and the analytics charts on those sections
  // are Phase 12's job, see docs/architecture.md § Phase 11)
  // ===========================================================================

  /**
   * "Today's Expenses" on the dashboard example (§53) is COGS specifically
   * — the example's own numbers only reconcile as Revenue(125,450) −
   * Expenses(63,200) = Gross Profit(62,250), i.e. "Expenses" there IS
   * `cogs.total` from the income statement, with Operating Expenses folded
   * into the Net Profit figure rather than shown as its own card. This
   * method mirrors that: `todayExpenses` is COGS, `todayOperatingExpenses`
   * is exposed separately for anyone who wants the full breakdown.
   *
   * Outstanding Receivables/Payables/Inventory Value are read by exact
   * account name ("Accounts Receivable" / "Accounts Payable" /
   * "Inventory") — the same "not best-effort, assumes the seeded chart's
   * names" convention AccountingService's automatic-posting methods
   * already use throughout Phase 10 (see AccountingService.getSystemAccount).
   * Cash Position is flag-driven (`isCashEquivalent`), not name-driven, so
   * it stays correct even if an org adds a second cash-equivalent account.
   */
  static async getFinancialDashboard(organizationId: string, params: { branchId?: string } = {}) {
    if (params.branchId) await this.assertBranchInOrg(organizationId, params.branchId);
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } });
    const now = new Date();
    const today = resolveDateRangePreset('today', organization.timezone, now);

    const income = await this.generateIncomeStatement(organizationId, { startDate: today.startDate, endDate: today.endDate, branchId: params.branchId });

    const pointInTimeRows = await this.aggregateLinesByAccountType(organizationId, ['ASSET', 'LIABILITY'], { endDate: now }, params.branchId);
    const balanceByName = new Map<string, Prisma.Decimal>();
    for (const row of pointInTimeRows) balanceByName.set(row.name, row.amount);

    const cashAccounts = await prisma.chartOfAccount.findMany({ where: { organizationId, isCashEquivalent: true }, select: { id: true } });
    const cashAccountIds = new Set(cashAccounts.map((a) => a.id));
    const cashPosition = sumAmounts(pointInTimeRows.filter((r) => cashAccountIds.has(r.accountId)));

    const namedBalance = (name: string) => balanceByName.get(name) ?? ZERO;

    return {
      date: today.startDate,
      branchId: params.branchId ?? null,
      todayRevenue: income.revenue.total,
      todayExpenses: income.cogs.total,
      todayOperatingExpenses: income.operatingExpenses.total,
      grossProfit: income.grossProfit,
      netProfit: income.netProfit,
      cashPosition,
      outstandingReceivables: namedBalance('Accounts Receivable'),
      outstandingPayables: namedBalance('Accounts Payable'),
      inventoryValue: namedBalance('Inventory'),
    };
  }
}
