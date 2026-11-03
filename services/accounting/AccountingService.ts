import 'server-only';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AccountType, DebitCredit, FinancialTransactionType, CashFlowCategory } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import type {
  CreateAccountInput,
  UpdateAccountInput,
  ListAccountsQueryInput,
  CreateJournalEntryInput,
  ListJournalEntriesQueryInput,
  ReverseJournalEntryInput,
  CreateVendorInput,
  UpdateVendorInput,
  CreateExpenseCategoryInput,
  UpdateExpenseCategoryInput,
  CreateExpenseInput,
  RejectExpenseInput,
  ListExpensesQueryInput,
  AddExpenseAttachmentInput,
} from '@/lib/validation/accounting';

type Tx = Prisma.TransactionClient;
type AnyClient = PrismaClient | Tx;

const JOURNAL_ENTRY_INCLUDE = { lines: { include: { account: true } } } satisfies Prisma.JournalEntryInclude;

// Master spec §28's seeded chart, verbatim, plus one deliberate addition:
// "Waste" under EXPENSES. §28's own EXPENSE list has no waste-specific
// account, but §37 explicitly requires "Waste: Inventory decreases + Waste/
// expense increases" — every other spec-listed account maps 1:1 to a line
// in §28, and this is the one place §28 and §37 don't quite line up. Adding
// a "Waste" expense account (rather than folding it into "Other Expenses")
// keeps waste cost separately visible on the trial balance/income
// statement, which is exactly the kind of thing an owner dashboard (Phase
// 12) would want broken out — and §37 itself says "all rules must be
// configurable," so extending the seeded chart is explicitly invited, not
// a deviation from it.
const NORMAL_BALANCE_BY_TYPE: Record<AccountType, DebitCredit> = {
  ASSET: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  REVENUE: 'CREDIT',
  COGS: 'DEBIT',
  EXPENSE: 'DEBIT',
};

// Phase 11 — cashFlowCategory classifies each account for
// generateCashFlow's direct method (see that method's file-header comment
// for the full reasoning). isCashEquivalent marks the two accounts that
// ARE cash — they get no category of their own since a cash account never
// classifies against itself. Every other account defaults to OPERATING
// (the working-capital/income-statement accounts every automatic posting
// in this build actually touches) except Equipment (a fixed-asset
// purchase is Investing) and the two capital accounts (Financing).
type ChartOfAccountSeed = { code: string; name: string; type: AccountType; isCashEquivalent?: boolean; cashFlowCategory?: CashFlowCategory };

const DEFAULT_CHART_OF_ACCOUNTS: ReadonlyArray<ChartOfAccountSeed> = [
  { code: '1000', name: 'Cash', type: 'ASSET', isCashEquivalent: true },
  { code: '1010', name: 'Bank', type: 'ASSET', isCashEquivalent: true },
  { code: '1100', name: 'Accounts Receivable', type: 'ASSET', cashFlowCategory: 'OPERATING' },
  { code: '1200', name: 'Inventory', type: 'ASSET', cashFlowCategory: 'OPERATING' },
  { code: '1300', name: 'Equipment', type: 'ASSET', cashFlowCategory: 'INVESTING' },
  { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', cashFlowCategory: 'OPERATING' },
  { code: '2100', name: 'Customer Deposits', type: 'LIABILITY', cashFlowCategory: 'OPERATING' },
  { code: '2200', name: 'Taxes Payable', type: 'LIABILITY', cashFlowCategory: 'OPERATING' },
  { code: '2300', name: 'Loans', type: 'LIABILITY', cashFlowCategory: 'FINANCING' },
  { code: '3000', name: "Owner's Equity", type: 'EQUITY', cashFlowCategory: 'FINANCING' },
  { code: '3100', name: 'Retained Earnings', type: 'EQUITY', cashFlowCategory: 'FINANCING' },
  { code: '4000', name: 'Dine-in Revenue', type: 'REVENUE', cashFlowCategory: 'OPERATING' },
  { code: '4010', name: 'Take-out Revenue', type: 'REVENUE', cashFlowCategory: 'OPERATING' },
  { code: '4020', name: 'Delivery Revenue', type: 'REVENUE', cashFlowCategory: 'OPERATING' },
  { code: '4030', name: 'Catering Revenue', type: 'REVENUE', cashFlowCategory: 'OPERATING' },
  { code: '4090', name: 'Other Revenue', type: 'REVENUE', cashFlowCategory: 'OPERATING' },
  { code: '5000', name: 'Food Cost', type: 'COGS', cashFlowCategory: 'OPERATING' },
  { code: '5010', name: 'Beverage Cost', type: 'COGS', cashFlowCategory: 'OPERATING' },
  { code: '5020', name: 'Packaging', type: 'COGS', cashFlowCategory: 'OPERATING' },
  { code: '5030', name: 'Catering Cost', type: 'COGS', cashFlowCategory: 'OPERATING' },
  { code: '5040', name: 'Delivery Cost', type: 'COGS', cashFlowCategory: 'OPERATING' },
  { code: '6000', name: 'Payroll', type: 'EXPENSE', cashFlowCategory: 'OPERATING' },
  { code: '6010', name: 'Rent', type: 'EXPENSE', cashFlowCategory: 'OPERATING' },
  { code: '6020', name: 'Utilities', type: 'EXPENSE', cashFlowCategory: 'OPERATING' },
  { code: '6030', name: 'Marketing', type: 'EXPENSE', cashFlowCategory: 'OPERATING' },
  { code: '6040', name: 'Insurance', type: 'EXPENSE', cashFlowCategory: 'OPERATING' },
  { code: '6050', name: 'Repairs', type: 'EXPENSE', cashFlowCategory: 'OPERATING' },
  { code: '6060', name: 'Transportation', type: 'EXPENSE', cashFlowCategory: 'OPERATING' },
  { code: '6070', name: 'Software', type: 'EXPENSE', cashFlowCategory: 'OPERATING' },
  { code: '6080', name: 'Waste', type: 'EXPENSE', cashFlowCategory: 'OPERATING' },
  { code: '6090', name: 'Other Expenses', type: 'EXPENSE', cashFlowCategory: 'OPERATING' },
];

// Phase 11 — default cashFlowCategory for an account an org creates itself
// via createAccount (no Equipment/Loans-style special case possible from
// type alone, so EQUITY defaults to Financing — the only type where that's
// unambiguous — and everything else defaults to Operating, overridable via
// input.cashFlowCategory for e.g. a custom fixed-asset account).
const DEFAULT_CASH_FLOW_CATEGORY_BY_TYPE: Record<AccountType, CashFlowCategory> = {
  ASSET: 'OPERATING',
  LIABILITY: 'OPERATING',
  EQUITY: 'FINANCING',
  REVENUE: 'OPERATING',
  COGS: 'OPERATING',
  EXPENSE: 'OPERATING',
};

type LedgerLine = { accountId: string; debit?: Prisma.Decimal | string | number; credit?: Prisma.Decimal | string | number; description?: string };

export class AccountingService {
  // ===========================================================================
  // Chart of accounts
  // ===========================================================================

  /**
   * Idempotent — checks before creating, so it is safe to call both from
   * AuthService.register (a brand-new organization) and from the seed
   * script / a standalone provisioning endpoint for an organization that
   * existed before this phase shipped (every organization created in
   * Phases 1-9 of this build, including the demo org). See schema.prisma's
   * "Phase 10 — Accounting" comment block, decision #1.
   */
  static async ensureChartOfAccounts(client: AnyClient, organizationId: string): Promise<void> {
    const existing = await client.chartOfAccount.findFirst({ where: { organizationId } });
    if (existing) return;
    await client.chartOfAccount.createMany({
      data: DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({
        organizationId,
        code: a.code,
        name: a.name,
        type: a.type,
        normalBalance: NORMAL_BALANCE_BY_TYPE[a.type],
        isCashEquivalent: a.isCashEquivalent ?? false,
        cashFlowCategory: a.cashFlowCategory ?? null,
      })),
    });
  }

  static async listAccounts(
  organizationId: string,
  query: { type?: ListAccountsQueryInput['type']; includeInactive?: boolean },
) {
    return prisma.chartOfAccount.findMany({
      where: {
        organizationId,
        type: query.type,
        ...(query.includeInactive ? {} : { active: true }),
      },
      orderBy: { code: 'asc' },
    });
  }

  static async createAccount(organizationId: string, input: CreateAccountInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const account = await tx.chartOfAccount.create({
        data: {
          organizationId,
          code: input.code,
          name: input.name,
          type: input.type,
          normalBalance: NORMAL_BALANCE_BY_TYPE[input.type],
          description: input.description,
          isSystem: false,
          // A brand-new custom account is never itself a cash account (an
          // org that actually wants a second cash-equivalent account, e.g.
          // a GCash wallet, edits isCashEquivalent via updateAccount after
          // creation — kept out of createAccount's input to avoid two
          // fields fighting over the same "is this cash?" question).
          isCashEquivalent: false,
          cashFlowCategory: input.cashFlowCategory ?? DEFAULT_CASH_FLOW_CATEGORY_BY_TYPE[input.type],
        },
      });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'account.create', entityType: 'ChartOfAccount', entityId: account.id, newValue: account,
      });
      return account;
    });
  }

  static async updateAccount(organizationId: string, accountId: string, input: UpdateAccountInput, actorUserId: string) {
    const existing = await this.assertAccountInOrg(organizationId, accountId);
    return prisma.$transaction(async (tx) => {
      const account = await tx.chartOfAccount.update({ where: { id: accountId }, data: input });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'account.update', entityType: 'ChartOfAccount', entityId: account.id, previousValue: existing, newValue: account,
      });
      return account;
    });
  }

  private static async assertAccountInOrg(organizationId: string, accountId: string) {
    const account = await prisma.chartOfAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) throw new NotFoundError('Account');
    return account;
  }

  /** Looks up a seeded/system account by its exact name — used by every automatic-posting method below. Throws if the chart hasn't been provisioned; see the class-level note on why this is intentionally NOT best-effort. */
  private static async getSystemAccount(client: AnyClient, organizationId: string, name: string) {
    const account = await client.chartOfAccount.findUnique({ where: { organizationId_name: { organizationId, name } } });
    if (!account) {
      throw new NotFoundError(
        `Chart of accounts entry "${name}" for this organization (run AccountingService.ensureChartOfAccounts first)`,
      );
    }
    return account;
  }

  // ===========================================================================
  // Accounting periods
  // ===========================================================================

  static async listPeriods(organizationId: string) {
    return prisma.accountingPeriod.findMany({ where: { organizationId }, orderBy: { startDate: 'desc' } });
  }

  /** Finds or lazily creates the calendar-month period covering `date`. Throws if that period is already CLOSED — see schema.prisma decision #5. */
  private static async resolvePeriodForDate(client: Tx, organizationId: string, date: Date) {
    const startDate = new Date(date.getFullYear(), date.getMonth(), 1);
    const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    let period = await client.accountingPeriod.findUnique({
      where: { organizationId_startDate: { organizationId, startDate } },
    });
    if (!period) {
      period = await client.accountingPeriod.create({ data: { organizationId, startDate, endDate } });
    }
    if (period.status === 'CLOSED') {
      throw new ConflictError(
        `The accounting period for ${startDate.toISOString().slice(0, 7)} is closed — entries can no longer be posted to it.`,
      );
    }
    return period;
  }

  /**
   * Refuses to close a period with any DRAFT entry still dated inside it —
   * the books cannot close with something half-posted. Once CLOSED, no new
   * or reversing entry may date into this period again;
   * resolvePeriodForDate enforces that on every future posting attempt.
   */
  static async closePeriod(organizationId: string, periodId: string, actorUserId: string) {
    const period = await prisma.accountingPeriod.findFirst({ where: { id: periodId, organizationId } });
    if (!period) throw new NotFoundError('Accounting period');
    if (period.status !== 'OPEN') throw new ConflictError(`This period is already ${period.status}.`);

    const draftCount = await prisma.journalEntry.count({ where: { organizationId, periodId, status: 'DRAFT' } });
    if (draftCount > 0) {
      throw new ConflictError(
        `Cannot close this period — ${draftCount} draft journal ${draftCount === 1 ? 'entry' : 'entries'} still need to be posted or resolved first.`,
      );
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.accountingPeriod.update({
        where: { id: periodId },
        data: { status: 'CLOSED', closedAt: new Date(), closedByUserId: actorUserId },
      });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'accounting_period.close', entityType: 'AccountingPeriod', entityId: periodId,
        previousValue: { status: 'OPEN' }, newValue: { status: 'CLOSED' },
      });
      return updated;
    });
  }

  // ===========================================================================
  // Journal entries — manual (accountant-authored) path
  // ===========================================================================

  static async listJournalEntries(organizationId: string, query: ListJournalEntriesQueryInput) {
    return prisma.journalEntry.findMany({
      where: {
        organizationId,
        branchId: query.branchId,
        status: query.status,
        ...(query.accountId ? { lines: { some: { accountId: query.accountId } } } : {}),
        ...(query.from || query.to
          ? { entryDate: { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } }
          : {}),
      },
      include: JOURNAL_ENTRY_INCLUDE,
      orderBy: { entryDate: 'desc' },
      // Phase 15 hardening: bounded (previously unbounded — journal-entry
      // volume grows monotonically and is never pruned; see
      // docs/architecture.md § 23).
      take: query.take,
      skip: query.skip,
    });
  }

  static async getJournalEntry(organizationId: string, entryId: string) {
    const entry = await prisma.journalEntry.findFirst({
      where: { id: entryId, organizationId },
      include: JOURNAL_ENTRY_INCLUDE,
    });
    if (!entry) throw new NotFoundError('Journal entry');
    return entry;
  }

  /** Manual entries start life as DRAFT — an accountant drafts, then explicitly posts (or someone else does), matching §45's "create" and "post" as distinct responsibilities. */
  static async createJournalEntry(organizationId: string, input: CreateJournalEntryInput, actorUserId: string) {
    if (input.branchId) await this.assertBranchInOrg(organizationId, input.branchId);
    for (const line of input.lines) await this.assertAccountInOrg(organizationId, line.accountId);
    this.assertBalanced(input.lines);
    const entryDate = new Date(input.entryDate);

    return prisma.$transaction(async (tx) => {
      const period = await this.resolvePeriodForDate(tx, organizationId, entryDate);
      const entry = await tx.journalEntry.create({
        data: {
          organizationId,
          branchId: input.branchId,
          periodId: period.id,
          entryDate,
          description: input.description,
          status: 'DRAFT',
          createdByUserId: actorUserId,
          lines: { create: input.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description })) },
        },
        include: JOURNAL_ENTRY_INCLUDE,
      });
      await writeAuditLog(tx, {
        organizationId, branchId: input.branchId ?? undefined, userId: actorUserId,
        action: 'journal_entry.create', entityType: 'JournalEntry', entityId: entry.id, newValue: entry,
      });
      return entry;
    });
  }

  static async postJournalEntry(organizationId: string, entryId: string, actorUserId: string) {
    const entry = await this.getJournalEntry(organizationId, entryId);
    if (entry.status !== 'DRAFT') {
      throw new ConflictError(`Cannot post a journal entry that is ${entry.status} — only DRAFT entries can be posted.`);
    }
    this.assertBalanced(entry.lines);

    return prisma.$transaction(async (tx) => {
      const period = await tx.accountingPeriod.findUniqueOrThrow({ where: { id: entry.periodId } });
      if (period.status === 'CLOSED') {
        throw new ConflictError(`Cannot post — the accounting period covering this entry's date has since been closed.`);
      }
      // Phase 15 hardening: guards against two concurrent "post this
      // entry" requests both reading DRAFT above and both entering this
      // transaction — without status in the WHERE clause, both could
      // "successfully" post the same entry, and a caller relying on
      // postedAt/postedByUserId as an audit trail would see whichever
      // request happened to write last. updateMany (not update) because
      // {id, status} isn't a unique-constraint shape Prisma's update()
      // accepts.
      const updateResult = await tx.journalEntry.updateMany({
        where: { id: entryId, status: 'DRAFT' },
        data: { status: 'POSTED', postedAt: new Date(), postedByUserId: actorUserId },
      });
      if (updateResult.count === 0) {
        throw new ConflictError('Journal entry status changed concurrently — reload and try again.');
      }
      const posted = await tx.journalEntry.findUniqueOrThrow({ where: { id: entryId }, include: JOURNAL_ENTRY_INCLUDE });
      await writeAuditLog(tx, {
        organizationId, branchId: entry.branchId ?? undefined, userId: actorUserId,
        action: 'journal_entry.post', entityType: 'JournalEntry', entityId: entry.id,
        previousValue: { status: 'DRAFT' }, newValue: { status: 'POSTED' },
      });
      return posted;
    });
  }

  /**
   * The ONLY way to correct a posted entry — master spec §27's "do not
   * allow a posted journal entry to be directly edited... use reversal/
   * correction entries," enforced by there being no other method that
   * touches a POSTED entry's lines. Creates a brand-new POSTED entry with
   * every line's debit/credit swapped, dated today (in whatever period is
   * currently open — never backdated into the original's own period, which
   * may since have closed), and flips the original's status to REVERSED.
   * The @unique constraint on reversalOfEntryId means an entry can only
   * ever be reversed once.
   */
  static async reverseJournalEntry(organizationId: string, entryId: string, input: ReverseJournalEntryInput, actorUserId: string) {
    const entry = await this.getJournalEntry(organizationId, entryId);
    if (entry.status !== 'POSTED') {
      throw new ConflictError(`Cannot reverse a journal entry that is ${entry.status} — only POSTED entries may be reversed.`);
    }
    const alreadyReversed = await prisma.journalEntry.findFirst({ where: { reversalOfEntryId: entryId } });
    if (alreadyReversed) throw new ConflictError('This journal entry has already been reversed.');

    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const period = await this.resolvePeriodForDate(tx, organizationId, now);
      const reversal = await tx.journalEntry.create({
        data: {
          organizationId,
          branchId: entry.branchId,
          periodId: period.id,
          entryDate: now,
          description: `Reversal: ${entry.description} — ${input.reason}`,
          referenceType: entry.referenceType,
          referenceId: entry.referenceId,
          status: 'POSTED',
          postedAt: now,
          postedByUserId: actorUserId,
          createdByUserId: actorUserId,
          reversalOfEntryId: entry.id,
          lines: { create: entry.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: l.description })) },
        },
        include: JOURNAL_ENTRY_INCLUDE,
      });
      await tx.journalEntry.update({ where: { id: entryId }, data: { status: 'REVERSED' } });
      await writeAuditLog(tx, {
        organizationId, branchId: entry.branchId ?? undefined, userId: actorUserId,
        action: 'journal_entry.reverse', entityType: 'JournalEntry', entityId: entry.id,
        newValue: { reversalEntryId: reversal.id, reason: input.reason },
      });
      return reversal;
    });
  }

  /** Every line must have exactly one positive side, and the entry's debits must equal its credits — the master-spec-mandated invariant (§27, §49), enforced here as a fail-fast layer in front of the database CHECK constraint. */
  private static assertBalanced(lines: ReadonlyArray<{ debit?: Prisma.Decimal | string | number; credit?: Prisma.Decimal | string | number }>) {
    if (lines.length < 2) throw new ConflictError('A journal entry needs at least two lines.');
    let debitTotal = new Prisma.Decimal(0);
    let creditTotal = new Prisma.Decimal(0);
    for (const line of lines) {
      const debit = new Prisma.Decimal(line.debit ?? 0);
      const credit = new Prisma.Decimal(line.credit ?? 0);
      if ((debit.gt(0) && credit.gt(0)) || (debit.isZero() && credit.isZero())) {
        throw new ConflictError('Each journal entry line must have exactly one of debit or credit set to a positive amount.');
      }
      debitTotal = debitTotal.plus(debit);
      creditTotal = creditTotal.plus(credit);
    }
    if (!debitTotal.equals(creditTotal)) {
      throw new ConflictError(`Journal entry does not balance: total debits ${debitTotal.toFixed(2)} != total credits ${creditTotal.toFixed(2)}.`);
    }
  }

  /**
   * Shared by every automatic-posting method below. Idempotent by
   * pre-checking the (referenceType, referenceId, financialTransactionType)
   * key before creating anything — a repeat call returns the existing
   * entry rather than posting twice, per §47.
   */
  private static async postAutomaticEntry(
    tx: Tx,
    args: {
      organizationId: string;
      branchId?: string | null;
      entryDate?: Date;
      description: string;
      referenceType: string;
      referenceId: string;
      financialTransactionType: FinancialTransactionType;
      lines: LedgerLine[];
      actorUserId?: string | null;
    },
  ) {
    const existing = await tx.financialTransaction.findUnique({
      where: { referenceType_referenceId_type: { referenceType: args.referenceType, referenceId: args.referenceId, type: args.financialTransactionType } },
      include: { journalEntry: { include: JOURNAL_ENTRY_INCLUDE } },
    });
    if (existing) return existing.journalEntry;

    this.assertBalanced(args.lines);
    const entryDate = args.entryDate ?? new Date();
    const period = await this.resolvePeriodForDate(tx, args.organizationId, entryDate);

    const entry = await tx.journalEntry.create({
      data: {
        organizationId: args.organizationId,
        branchId: args.branchId ?? undefined,
        periodId: period.id,
        entryDate,
        description: args.description,
        referenceType: args.referenceType,
        referenceId: args.referenceId,
        status: 'POSTED',
        postedAt: entryDate,
        postedByUserId: args.actorUserId ?? undefined,
        createdByUserId: args.actorUserId ?? undefined,
        lines: {
          create: args.lines.map((l) => ({
            accountId: l.accountId,
            debit: new Prisma.Decimal(l.debit ?? 0).toFixed(2),
            credit: new Prisma.Decimal(l.credit ?? 0).toFixed(2),
            description: l.description,
          })),
        },
      },
      include: JOURNAL_ENTRY_INCLUDE,
    });

    await tx.financialTransaction.create({
      data: {
        organizationId: args.organizationId,
        branchId: args.branchId ?? undefined,
        type: args.financialTransactionType,
        referenceType: args.referenceType,
        referenceId: args.referenceId,
        journalEntryId: entry.id,
      },
    });

    return entry;
  }

  // ===========================================================================
  // Balances / trial balance
  // ===========================================================================

  static async getAccountBalance(organizationId: string, accountId: string, asOfDate?: Date) {
    const account = await this.assertAccountInOrg(organizationId, accountId);
    const agg = await prisma.journalEntryLine.aggregate({
      where: {
        accountId,
        journalEntry: {
          organizationId,
          status: 'POSTED',
          ...(asOfDate ? { entryDate: { lte: asOfDate } } : {}),
        },
      },
      _sum: { debit: true, credit: true },
    });
    const debitTotal = agg._sum.debit ?? new Prisma.Decimal(0);
    const creditTotal = agg._sum.credit ?? new Prisma.Decimal(0);
    const balance = account.normalBalance === 'DEBIT' ? debitTotal.minus(creditTotal) : creditTotal.minus(debitTotal);
    return { account, debitTotal, creditTotal, balance };
  }

  /**
   * The automated proof master spec §49 asks for: every active account's
   * posted debit/credit totals, plus the overall SUM(DEBITS) = SUM(CREDITS)
   * check. One query per account (an honest N+1, same flagged pattern as
   * Phase 8's segmentBreakdown) — fine at this build's data volumes, a
   * batched GROUP BY would be the real-production version.
   */
  static async generateTrialBalance(organizationId: string, asOfDate?: Date) {
    const accounts = await prisma.chartOfAccount.findMany({ where: { organizationId, active: true }, orderBy: { code: 'asc' } });
    const rows = await Promise.all(
      accounts.map(async (account) => {
        const { debitTotal, creditTotal, balance } = await this.getAccountBalance(organizationId, account.id, asOfDate);
        return { accountId: account.id, code: account.code, name: account.name, type: account.type, normalBalance: account.normalBalance, debit: debitTotal, credit: creditTotal, balance };
      }),
    );
    const totalDebits = rows.reduce((sum, r) => sum.plus(r.debit), new Prisma.Decimal(0));
    const totalCredits = rows.reduce((sum, r) => sum.plus(r.credit), new Prisma.Decimal(0));
    return { asOfDate: asOfDate ?? new Date(), accounts: rows, totalDebits, totalCredits, isBalanced: totalDebits.equals(totalCredits) };
  }

  private static async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }

  // ===========================================================================
  // Vendors / expense categories
  // ===========================================================================

  static async listVendors(organizationId: string) {
    return prisma.vendor.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
  }

  static async createVendor(organizationId: string, input: CreateVendorInput, actorUserId: string) {
    
const existing = await prisma.vendor.findFirst({
  where: {
    organizationId,
    name: input.name,
    active: true,
  },
});

    if (existing) throw new ConflictError(`A vendor named "${input.name}" already exists.`);
    return prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.create({ data: { organizationId, ...input } });
      await writeAuditLog(tx, { organizationId, userId: actorUserId, action: 'vendor.create', entityType: 'Vendor', entityId: vendor.id, newValue: vendor });
      return vendor;
    });
  }

  static async updateVendor(organizationId: string, vendorId: string, input: UpdateVendorInput, actorUserId: string) {
    const existing = await this.assertVendorInOrg(organizationId, vendorId);
    return prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.update({ where: { id: vendorId }, data: input });
      await writeAuditLog(tx, { organizationId, userId: actorUserId, action: 'vendor.update', entityType: 'Vendor', entityId: vendor.id, previousValue: existing, newValue: vendor });
      return vendor;
    });
  }

  private static async assertVendorInOrg(organizationId: string, vendorId: string) {
    const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, organizationId } });
    if (!vendor) throw new NotFoundError('Vendor');
    return vendor;
  }

  static async listExpenseCategories(organizationId: string) {
    return prisma.expenseCategory.findMany({ where: { organizationId }, include: { defaultAccount: true }, orderBy: { name: 'asc' } });
  }

  static async createExpenseCategory(organizationId: string, input: CreateExpenseCategoryInput, actorUserId: string) {
    if (input.defaultAccountId) await this.assertAccountInOrg(organizationId, input.defaultAccountId);
    const existing = await prisma.expenseCategory.findFirst({
  where: {
    organizationId,
    name: input.name,
    active: true,
  },
});
    if (existing) throw new ConflictError(`An expense category named "${input.name}" already exists.`);
    return prisma.$transaction(async (tx) => {
      const category = await tx.expenseCategory.create({ data: { organizationId, name: input.name, defaultAccountId: input.defaultAccountId } });
      await writeAuditLog(tx, { organizationId, userId: actorUserId, action: 'expense_category.create', entityType: 'ExpenseCategory', entityId: category.id, newValue: category });
      return category;
    });
  }
  static async updateExpenseCategory(organizationId: string, categoryId: string, input: UpdateExpenseCategoryInput, actorUserId: string) {
    
const existing = await prisma.expenseCategory.findFirst({
  where: {
    organizationId,
    name: input.name,
    active: true,
  },
});
    if (input.defaultAccountId) await this.assertAccountInOrg(organizationId, input.defaultAccountId);
    return prisma.$transaction(async (tx) => {
      const category = await tx.expenseCategory.update({ where: { id: categoryId }, data: { name: input.name, defaultAccountId: input.defaultAccountId, active: input.active } });
      await writeAuditLog(tx, { organizationId, userId: actorUserId, action: 'expense_category.update', entityType: 'ExpenseCategory', entityId: category.id, previousValue: existing, newValue: category });
      return category;
    });
  }

  private static async assertCategoryInOrg(organizationId: string, categoryId: string) {
    const category = await prisma.expenseCategory.findFirst({ where: { id: categoryId, organizationId } });
    if (!category) throw new NotFoundError('Expense category');
    return category;
  }

  // ===========================================================================
  // Expenses — create (PENDING) -> approve (posts a journal entry) | reject
  // ===========================================================================

  static async listExpenses(organizationId: string, branchId: string, query: ListExpensesQueryInput) {
    await this.assertBranchInOrg(organizationId, branchId);
    // Phase 15 hardening: bounded (previously unbounded — see
    // docs/architecture.md § 23).
    return prisma.expense.findMany({
      where: { organizationId, branchId, approvalStatus: query.approvalStatus, categoryId: query.categoryId, vendorId: query.vendorId },
      include: { vendor: true, category: true, attachments: true },
      orderBy: { expenseDate: 'desc' },
      take: query.take,
      skip: query.skip,
    });
  }

  static async getExpense(organizationId: string, branchId: string, expenseId: string) {
    const expense = await prisma.expense.findFirst({
      where: { id: expenseId, branchId, organizationId },
      include: { vendor: true, category: true, attachments: true },
    });
    if (!expense) throw new NotFoundError('Expense');
    return expense;
  }

  static async createExpense(organizationId: string, branchId: string, input: CreateExpenseInput, actorUserId: string) {
    await this.assertBranchInOrg(organizationId, branchId);
    await this.assertCategoryInOrg(organizationId, input.categoryId);
    if (input.vendorId) await this.assertVendorInOrg(organizationId, input.vendorId);

    return prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          organizationId, branchId,
          vendorId: input.vendorId, categoryId: input.categoryId,
          amount: input.amount, expenseDate: new Date(input.expenseDate),
          paymentMethod: input.paymentMethod, notes: input.notes,
          recordedByUserId: actorUserId,
        },
        include: { vendor: true, category: true, attachments: true },
      });
      await writeAuditLog(tx, { organizationId, branchId, userId: actorUserId, action: 'expense.create', entityType: 'Expense', entityId: expense.id, newValue: expense });
      return expense;
    });
  }

  /**
   * Posts the expense to the ledger — Debit the category's default account,
   * Credit Cash (CASH payment method) or Bank (everything else). Refuses if
   * the category has no default account configured, rather than guessing
   * one — per §29's "AI must never directly invent accounting entries."
   */
  static async approveExpense(organizationId: string, branchId: string, expenseId: string, actorUserId: string) {
    const expense = await this.getExpense(organizationId, branchId, expenseId);
    if (expense.approvalStatus !== 'PENDING') {
      throw new ConflictError(`Cannot approve an expense that is ${expense.approvalStatus}.`);
    }
    if (!expense.category.defaultAccountId) {
      throw new ConflictError(`Expense category "${expense.category.name}" has no default account configured — set one before approving expenses in this category.`);
    }
const defaultAccountId = expense.category.defaultAccountId;

    return prisma.$transaction(async (tx) => {
      // Phase 15 hardening: claim the expense (guarded on approvalStatus)
      // BEFORE creating the journal entry below — otherwise two concurrent
      // "approve this expense" requests could both pass the pre-
      // transaction PENDING check above, both call postAutomaticEntry, and
      // double-post the same expense to the ledger. updateMany (not
      // update) because {id, approvalStatus} isn't a unique-constraint
      // shape Prisma's update() accepts. If this whole transaction later
      // fails (e.g. postAutomaticEntry throws), the claim rolls back too.
      const claimResult = await tx.expense.updateMany({
        where: { id: expenseId, approvalStatus: 'PENDING' },
        data: { approvalStatus: 'APPROVED', approvedByUserId: actorUserId },
      });
      if (claimResult.count === 0) {
        throw new ConflictError('Expense approval status changed concurrently — reload and try again.');
      }

      const cashAccount = await this.getSystemAccount(tx, organizationId, expense.paymentMethod === 'CASH' ? 'Cash' : 'Bank');
      const entry = await this.postAutomaticEntry(tx, {
        organizationId, branchId,
        description: `Expense — ${expense.category.name}${expense.vendor ? ` (${expense.vendor.name})` : ''}`,
        referenceType: 'Expense', referenceId: expense.id,
        financialTransactionType: 'EXPENSE_POSTED',
        lines: [
          { accountId: defaultAccountId, debit: expense.amount },
          { accountId: cashAccount.id, credit: expense.amount },
        ],
        actorUserId,
      });
      const updated = await tx.expense.update({
        where: { id: expenseId },
        data: { journalEntryId: entry.id },
        include: { vendor: true, category: true, attachments: true },
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'expense.approve', entityType: 'Expense', entityId: expense.id,
        previousValue: { approvalStatus: 'PENDING' }, newValue: { approvalStatus: 'APPROVED', journalEntryId: entry.id },
      });
      return updated;
    });
  }

  static async rejectExpense(organizationId: string, branchId: string, expenseId: string, input: RejectExpenseInput, actorUserId: string) {
    const expense = await this.getExpense(organizationId, branchId, expenseId);
    if (expense.approvalStatus !== 'PENDING') {
      throw new ConflictError(`Cannot reject an expense that is ${expense.approvalStatus}.`);
    }
    return prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({
        where: { id: expenseId },
        data: { approvalStatus: 'REJECTED' },
        include: { vendor: true, category: true, attachments: true },
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'expense.reject', entityType: 'Expense', entityId: expense.id,
        previousValue: { approvalStatus: 'PENDING' }, newValue: { approvalStatus: 'REJECTED', reason: input.reason },
      });
      return updated;
    });
  }

  static async addExpenseAttachment(organizationId: string, branchId: string, expenseId: string, input: AddExpenseAttachmentInput, actorUserId: string) {
    await this.getExpense(organizationId, branchId, expenseId);
    return prisma.expenseAttachment.create({
      data: { expenseId, fileName: input.fileName, fileUrl: input.fileUrl, uploadedByUserId: actorUserId },
    });
  }

  // ===========================================================================
  // Financial transaction engine — real business events -> journal entries.
  // Every method here is called from ANOTHER service, inside that service's
  // already-open transaction (the same "one business event, one
  // transaction" discipline as Phase 6/7/9's cross-service side effects).
  // Unlike Phase 9's best-effort inventory consumption, none of these are
  // best-effort: a missing chart-of-accounts entry means the organization
  // was never provisioned correctly (a setup bug, not a normal data gap —
  // ensureChartOfAccounts always runs at registration), and financial
  // postings failing loudly beats silently losing revenue from the books.
  // ===========================================================================

  /**
   * Order -> COMPLETED. Posts up to two entries: revenue (Cash/AR split by
   * how much of the order has actually been paid so far, Credit the
   * order-type-matched revenue account net of discount plus delivery fee,
   * Credit Taxes Payable for tax collected) and COGS (Debit Food Cost,
   * Credit Inventory, using the exact consumption cost InventoryService
   * already computed while consuming ingredients for this same order —
   * see OrderService.updateStatus and InventoryService.consumeForOrder).
   * The two are independent: an order with ingredients consumed but zero
   * net revenue (fully discounted) still posts COGS; an order with no
   * recipe match still posts revenue.
   */
  static async recordOrderRevenue(
    tx: Tx,
    organizationId: string,
    branchId: string,
    order: { id: string; type: string; subtotal: Prisma.Decimal | string; discountTotal: Prisma.Decimal | string; taxTotal: Prisma.Decimal | string; deliveryFee: Prisma.Decimal | string; total: Prisma.Decimal | string },
    cogsAmount: Prisma.Decimal,
    actorUserId: string,
  ): Promise<void> {
    const total = new Prisma.Decimal(order.total);
    if (total.gt(0)) {
      const revenueAccountName = order.type === 'DINE_IN' ? 'Dine-in Revenue' : order.type === 'TAKEOUT' ? 'Take-out Revenue' : 'Delivery Revenue';
      const revenueAmount = new Prisma.Decimal(order.subtotal).minus(order.discountTotal).plus(order.deliveryFee);
      const taxAmount = new Prisma.Decimal(order.taxTotal);

      const paidAgg = await tx.orderPayment.aggregate({ where: { orderId: order.id, status: 'COMPLETED' }, _sum: { amount: true } });
      const paidSoFar = paidAgg._sum.amount ?? new Prisma.Decimal(0);
      const cashPortion = Prisma.Decimal.min(paidSoFar, total);
      const arPortion = total.minus(cashPortion);

      const [cashAccount, arAccount, revenueAccount, taxAccount] = await Promise.all([
        this.getSystemAccount(tx, organizationId, 'Cash'),
        this.getSystemAccount(tx, organizationId, 'Accounts Receivable'),
        this.getSystemAccount(tx, organizationId, revenueAccountName),
        this.getSystemAccount(tx, organizationId, 'Taxes Payable'),
      ]);

      const lines: LedgerLine[] = [];
      if (cashPortion.gt(0)) lines.push({ accountId: cashAccount.id, debit: cashPortion });
      if (arPortion.gt(0)) lines.push({ accountId: arAccount.id, debit: arPortion });
      if (revenueAmount.gt(0)) lines.push({ accountId: revenueAccount.id, credit: revenueAmount });
      if (taxAmount.gt(0)) lines.push({ accountId: taxAccount.id, credit: taxAmount });

      if (lines.length >= 2) {
        await this.postAutomaticEntry(tx, {
          organizationId, branchId, description: `Revenue — order ${order.id}`,
          referenceType: 'Order', referenceId: order.id, financialTransactionType: 'ORDER_REVENUE',
          lines, actorUserId,
        });
      }
    }

    if (cogsAmount.gt(0)) {
      const [cogsAccount, inventoryAccount] = await Promise.all([
        this.getSystemAccount(tx, organizationId, 'Food Cost'),
        this.getSystemAccount(tx, organizationId, 'Inventory'),
      ]);
      await this.postAutomaticEntry(tx, {
        organizationId, branchId, description: `COGS — order ${order.id}`,
        referenceType: 'Order', referenceId: order.id, financialTransactionType: 'ORDER_COGS',
        lines: [
          { accountId: cogsAccount.id, debit: cogsAmount },
          { accountId: inventoryAccount.id, credit: cogsAmount },
        ],
        actorUserId,
      });
    }
  }

  /** Reservation deposit marked PAID — §23: a liability, never automatic revenue. */
  static async recordReservationDepositPaid(tx: Tx, organizationId: string, branchId: string, reservation: { id: string; depositAmount: Prisma.Decimal | string | null }, actorUserId: string): Promise<void> {
    const amount = new Prisma.Decimal(reservation.depositAmount ?? 0);
    if (amount.lte(0)) return;
    const [cash, deposits] = await Promise.all([
      this.getSystemAccount(tx, organizationId, 'Cash'),
      this.getSystemAccount(tx, organizationId, 'Customer Deposits'),
    ]);
    await this.postAutomaticEntry(tx, {
      organizationId, branchId, description: `Deposit received — reservation ${reservation.id}`,
      referenceType: 'Reservation', referenceId: reservation.id, financialTransactionType: 'DEPOSIT_RECEIVED',
      lines: [{ accountId: cash.id, debit: amount }, { accountId: deposits.id, credit: amount }],
      actorUserId,
    });
  }

  /** Reservation deposit marked REFUNDED — reverses the liability, no revenue involved. */
  static async recordReservationDepositRefunded(tx: Tx, organizationId: string, branchId: string, reservation: { id: string; depositAmount: Prisma.Decimal | string | null }, actorUserId: string): Promise<void> {
    const amount = new Prisma.Decimal(reservation.depositAmount ?? 0);
    if (amount.lte(0)) return;
    const [cash, deposits] = await Promise.all([
      this.getSystemAccount(tx, organizationId, 'Cash'),
      this.getSystemAccount(tx, organizationId, 'Customer Deposits'),
    ]);
    await this.postAutomaticEntry(tx, {
      organizationId, branchId, description: `Deposit refunded — reservation ${reservation.id}`,
      referenceType: 'Reservation', referenceId: reservation.id, financialTransactionType: 'DEPOSIT_REFUNDED',
      lines: [{ accountId: deposits.id, debit: amount }, { accountId: cash.id, credit: amount }],
      actorUserId,
    });
  }

  /** Reservation reaches COMPLETED with a PAID deposit — the deposit is now earned, per §23. */
  static async recordReservationDepositEarned(tx: Tx, organizationId: string, branchId: string, reservation: { id: string; depositAmount: Prisma.Decimal | string | null }, actorUserId: string): Promise<void> {
    const amount = new Prisma.Decimal(reservation.depositAmount ?? 0);
    if (amount.lte(0)) return;
    const [deposits, revenue] = await Promise.all([
      this.getSystemAccount(tx, organizationId, 'Customer Deposits'),
      this.getSystemAccount(tx, organizationId, 'Dine-in Revenue'),
    ]);
    await this.postAutomaticEntry(tx, {
      organizationId, branchId, description: `Deposit earned — reservation ${reservation.id}`,
      referenceType: 'Reservation', referenceId: reservation.id, financialTransactionType: 'DEPOSIT_EARNED',
      lines: [{ accountId: deposits.id, debit: amount }, { accountId: revenue.id, credit: amount }],
      actorUserId,
    });
  }

  /** Catering DEPOSIT payment recorded — same liability-first policy as reservations. */
  static async recordCateringDepositReceived(tx: Tx, organizationId: string, branchId: string, payment: { id: string; amount: Prisma.Decimal | string }, actorUserId: string): Promise<void> {
    const amount = new Prisma.Decimal(payment.amount);
    if (amount.lte(0)) return;
    const [cash, deposits] = await Promise.all([
      this.getSystemAccount(tx, organizationId, 'Cash'),
      this.getSystemAccount(tx, organizationId, 'Customer Deposits'),
    ]);
    await this.postAutomaticEntry(tx, {
      organizationId, branchId, description: `Catering deposit received — payment ${payment.id}`,
      referenceType: 'CateringPayment', referenceId: payment.id, financialTransactionType: 'DEPOSIT_RECEIVED',
      lines: [{ accountId: cash.id, debit: amount }, { accountId: deposits.id, credit: amount }],
      actorUserId,
    });
  }

  /**
   * Catering DEPOSIT payment recorded with status REFUNDED — mirrors
   * recordReservationDepositRefunded. Only the DEPOSIT/REFUNDED combination
   * is wired to an automatic posting; a BALANCE payment recorded as
   * REFUNDED (a full-event refund after revenue was already recognized) is
   * deliberately left unwired — that requires reversing the earlier
   * DEPOSIT_EARNED entry via reverseJournalEntry, an accountant's manual
   * correction call rather than a rule this engine should invent on its
   * own (see class-level note on §29's "AI must never directly invent
   * accounting entries").
   */
  static async recordCateringDepositRefunded(tx: Tx, organizationId: string, branchId: string, payment: { id: string; amount: Prisma.Decimal | string }, actorUserId: string): Promise<void> {
    const amount = new Prisma.Decimal(payment.amount);
    if (amount.lte(0)) return;
    const [cash, deposits] = await Promise.all([
      this.getSystemAccount(tx, organizationId, 'Cash'),
      this.getSystemAccount(tx, organizationId, 'Customer Deposits'),
    ]);
    await this.postAutomaticEntry(tx, {
      organizationId, branchId, description: `Catering deposit refunded — payment ${payment.id}`,
      referenceType: 'CateringPayment', referenceId: payment.id, financialTransactionType: 'DEPOSIT_REFUNDED',
      lines: [{ accountId: deposits.id, debit: amount }, { accountId: cash.id, credit: amount }],
      actorUserId,
    });
  }

  /**
   * Catering BALANCE payment recorded — the point this build treats as "the
   * event happened, the account is settled" (see schema.prisma decision
   * #4). Revenue recognized is the SUM OF ACTUAL PAYMENTS RECEIVED for this
   * event to date (every prior DEPOSIT plus this BALANCE payment) — not the
   * quote's stated total — so the entry is always grounded in real recorded
   * cash movements rather than an assumed number, honoring §29's "AI must
   * never directly invent accounting entries" even when a customer ends up
   * paying slightly more or less than originally quoted.
   */
  static async recordCateringBalanceSettled(
    tx: Tx,
    organizationId: string,
    branchId: string,
    args: { eventId: string; balancePaymentId: string; balanceAmount: Prisma.Decimal | string; depositPaidToDate: Prisma.Decimal | string },
    actorUserId: string,
  ): Promise<void> {
    const balance = new Prisma.Decimal(args.balanceAmount);
    const deposit = new Prisma.Decimal(args.depositPaidToDate);
    const total = balance.plus(deposit);
    if (total.lte(0)) return;

    const [cash, deposits, revenue] = await Promise.all([
      this.getSystemAccount(tx, organizationId, 'Cash'),
      this.getSystemAccount(tx, organizationId, 'Customer Deposits'),
      this.getSystemAccount(tx, organizationId, 'Catering Revenue'),
    ]);
    const lines: LedgerLine[] = [];
    if (balance.gt(0)) lines.push({ accountId: cash.id, debit: balance });
    if (deposit.gt(0)) lines.push({ accountId: deposits.id, debit: deposit });
    lines.push({ accountId: revenue.id, credit: total });

    await this.postAutomaticEntry(tx, {
      organizationId, branchId, description: `Catering revenue earned — event ${args.eventId}`,
      referenceType: 'CateringPayment', referenceId: args.balancePaymentId, financialTransactionType: 'DEPOSIT_EARNED',
      lines, actorUserId,
    });
  }

  /**
   * A PO receiving call (InventoryService.receivePurchaseOrderItems).
   * Idempotency is deliberately keyed to one of the InventoryTransaction
   * rows THAT SPECIFIC CALL created (`anchorTransactionId`), not to the
   * PurchaseOrderId itself — a PO can legitimately be received against
   * multiple times (partial receiving is first-class, see Phase 9), and
   * keying to the PO alone would silently block every receipt after the
   * first from ever posting its own accounting entry.
   */
  static async recordInventoryPurchase(tx: Tx, organizationId: string, branchId: string, args: { purchaseOrderId: string; anchorTransactionId: string; totalCost: Prisma.Decimal }, actorUserId: string): Promise<void> {
    if (args.totalCost.lte(0)) return;
    const [inventory, ap] = await Promise.all([
      this.getSystemAccount(tx, organizationId, 'Inventory'),
      this.getSystemAccount(tx, organizationId, 'Accounts Payable'),
    ]);
    await this.postAutomaticEntry(tx, {
      organizationId, branchId, description: `Inventory purchase — PO ${args.purchaseOrderId}`,
      referenceType: 'InventoryTransaction', referenceId: args.anchorTransactionId, financialTransactionType: 'INVENTORY_PURCHASE',
      lines: [{ accountId: inventory.id, debit: args.totalCost }, { accountId: ap.id, credit: args.totalCost }],
      actorUserId,
    });
  }

  /** A waste record — each WasteRecord row is already a distinct entity per event, so it is naturally a safe idempotency key on its own (unlike PurchaseOrder receiving above). */
  static async recordInventoryWaste(tx: Tx, organizationId: string, branchId: string, args: { wasteRecordId: string; cost: Prisma.Decimal }, actorUserId: string): Promise<void> {
    if (args.cost.lte(0)) return;
    const [waste, inventory] = await Promise.all([
      this.getSystemAccount(tx, organizationId, 'Waste'),
      this.getSystemAccount(tx, organizationId, 'Inventory'),
    ]);
    await this.postAutomaticEntry(tx, {
      organizationId, branchId, description: `Inventory waste — ${args.wasteRecordId}`,
      referenceType: 'WasteRecord', referenceId: args.wasteRecordId, financialTransactionType: 'INVENTORY_WASTE',
      lines: [{ accountId: waste.id, debit: args.cost }, { accountId: inventory.id, credit: args.cost }],
      actorUserId,
    });
  }
}
