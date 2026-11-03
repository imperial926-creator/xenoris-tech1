import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { AccountingService } from '@/services/accounting/AccountingService';
import { resetDatabase } from '../../helpers/db';
import { ConflictError } from '@/lib/utils/api-error';
import type { CreateJournalEntryInput } from '@/lib/validation/accounting';

async function setupFixture(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Accounting Test ${suffix}`,
    organizationEmail: `accounting-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@accounting-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  return { user };
}

/** Bypasses zod (same pattern this codebase uses elsewhere for direct service calls) — journalEntryLineInputSchema's own refine is tested separately in tests/unit/accounting/validation.test.ts. */
function entryInput(overrides: Partial<CreateJournalEntryInput> & { lines: CreateJournalEntryInput['lines'] }): CreateJournalEntryInput {
  return { entryDate: new Date().toISOString(), description: 'Test entry', ...overrides };
}

describe('AccountingService — chart of accounts', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('seeds the standard 30-account chart on organization registration', async () => {
    const { user } = await setupFixture('a');
    const accounts = await AccountingService.listAccounts(user.organizationId, {});
    expect(accounts).toHaveLength(31);
    const cash = accounts.find((a) => a.name === 'Cash')!;
    expect(cash.code).toBe('1000');
    expect(cash.type).toBe('ASSET');
    expect(cash.normalBalance).toBe('DEBIT');
    const deposits = accounts.find((a) => a.name === 'Customer Deposits')!;
    expect(deposits.type).toBe('LIABILITY');
    expect(deposits.normalBalance).toBe('CREDIT');
  });

  it('ensureChartOfAccounts is idempotent — re-running it does not duplicate accounts', async () => {
    const { user } = await setupFixture('b');
    await prisma.$transaction((tx) => AccountingService.ensureChartOfAccounts(tx, user.organizationId));
    const accounts = await AccountingService.listAccounts(user.organizationId, {});
    expect(accounts).toHaveLength(31);
  });

  it('creates a custom (non-system) account', async () => {
    const { user } = await setupFixture('c');
    const account = await AccountingService.createAccount(user.organizationId, { code: '6100', name: 'Bank Fees', type: 'EXPENSE' }, user.id);
    expect(account.isSystem).toBe(false);
    expect(account.normalBalance).toBe('DEBIT');
  });

  it('deactivating an account is reversible via updateAccount', async () => {
    const { user } = await setupFixture('d');
    const accounts = await AccountingService.listAccounts(user.organizationId, {});
    const cash = accounts.find((a) => a.name === 'Cash')!;
    const deactivated = await AccountingService.updateAccount(user.organizationId, cash.id, { active: false }, user.id);
    expect(deactivated.active).toBe(false);
    const activeOnly = await AccountingService.listAccounts(user.organizationId, {});
    expect(activeOnly.find((a) => a.id === cash.id)).toBeUndefined();
    const withInactive = await AccountingService.listAccounts(user.organizationId, { includeInactive: true });
    expect(withInactive.find((a) => a.id === cash.id)).toBeDefined();
  });
});

describe('AccountingService — journal entries (manual path)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function accounts(organizationId: string) {
    const list = await AccountingService.listAccounts(organizationId, {});
    // Explicit generic + populate-by-loop — see prisma/seed.ts's identical
    // fix for why `new Map(list.map(...))` collapses the value type to `{}`.
    const byName = new Map<string, (typeof list)[number]>();
    for (const a of list) byName.set(a.name, a);
    return byName;
  }

  it('creates a balanced entry as DRAFT', async () => {
    const { user } = await setupFixture('e');
    const acc = await accounts(user.organizationId);
    const entry = await AccountingService.createJournalEntry(
      user.organizationId,
      entryInput({ lines: [{ accountId: acc.get('Cash')!.id, debit: '1000.00', credit: '0' }, { accountId: acc.get("Owner's Equity")!.id, debit: '0', credit: '1000.00' }] }),
      user.id,
    );
    expect(entry.status).toBe('DRAFT');
    expect(entry.lines).toHaveLength(2);
  });

  it('rejects an entry with fewer than two lines', async () => {
    const { user } = await setupFixture('f');
    const acc = await accounts(user.organizationId);
    await expect(
      AccountingService.createJournalEntry(user.organizationId, entryInput({ lines: [{ accountId: acc.get('Cash')!.id, debit: '100.00', credit: '0' }] }), user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects an entry whose debits don't equal its credits — master spec §27/§49's core invariant", async () => {
    const { user } = await setupFixture('g');
    const acc = await accounts(user.organizationId);
    await expect(
      AccountingService.createJournalEntry(
        user.organizationId,
        entryInput({ lines: [{ accountId: acc.get('Cash')!.id, debit: '100.00', credit: '0' }, { accountId: acc.get("Owner's Equity")!.id, debit: '0', credit: '99.00' }] }),
        user.id,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('posts a DRAFT entry, and refuses to post it again', async () => {
    const { user } = await setupFixture('h');
    const acc = await accounts(user.organizationId);
    const entry = await AccountingService.createJournalEntry(
      user.organizationId,
      entryInput({ lines: [{ accountId: acc.get('Cash')!.id, debit: '500.00', credit: '0' }, { accountId: acc.get("Owner's Equity")!.id, debit: '0', credit: '500.00' }] }),
      user.id,
    );
    const posted = await AccountingService.postJournalEntry(user.organizationId, entry.id, user.id);
    expect(posted.status).toBe('POSTED');
    await expect(AccountingService.postJournalEntry(user.organizationId, entry.id, user.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('reverses a POSTED entry with exactly swapped debit/credit lines, and refuses a second reversal', async () => {
    const { user } = await setupFixture('i');
    const acc = await accounts(user.organizationId);
    const cash = acc.get('Cash')!;
    const equity = acc.get("Owner's Equity")!;
    const entry = await AccountingService.createJournalEntry(
      user.organizationId,
      entryInput({ lines: [{ accountId: cash.id, debit: '750.00', credit: '0' }, { accountId: equity.id, debit: '0', credit: '750.00' }] }),
      user.id,
    );
    await AccountingService.postJournalEntry(user.organizationId, entry.id, user.id);

    const reversal = await AccountingService.reverseJournalEntry(user.organizationId, entry.id, { reason: 'Booked in error' }, user.id);
    expect(reversal.status).toBe('POSTED');
    expect(reversal.reversalOfEntryId).toBe(entry.id);
    const cashLine = reversal.lines.find((l) => l.accountId === cash.id)!;
    const equityLine = reversal.lines.find((l) => l.accountId === equity.id)!;
    expect(cashLine.credit.toFixed(2)).toBe('750.00');
    expect(cashLine.debit.toFixed(2)).toBe('0.00');
    expect(equityLine.debit.toFixed(2)).toBe('750.00');

    const original = await AccountingService.getJournalEntry(user.organizationId, entry.id);
    expect(original.status).toBe('REVERSED');

    await expect(
      AccountingService.reverseJournalEntry(user.organizationId, entry.id, { reason: 'Try again' }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('cannot reverse a DRAFT entry (only POSTED entries may be reversed)', async () => {
    const { user } = await setupFixture('j');
    const acc = await accounts(user.organizationId);
    const entry = await AccountingService.createJournalEntry(
      user.organizationId,
      entryInput({ lines: [{ accountId: acc.get('Cash')!.id, debit: '10.00', credit: '0' }, { accountId: acc.get("Owner's Equity")!.id, debit: '0', credit: '10.00' }] }),
      user.id,
    );
    await expect(
      AccountingService.reverseJournalEntry(user.organizationId, entry.id, { reason: 'x' }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('AccountingService — trial balance and accounting periods', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function accounts(organizationId: string) {
    const list = await AccountingService.listAccounts(organizationId, {});
    // Explicit generic + populate-by-loop — see prisma/seed.ts's identical
    // fix for why `new Map(list.map(...))` collapses the value type to `{}`.
    const byName = new Map<string, (typeof list)[number]>();
    for (const a of list) byName.set(a.name, a);
    return byName;
  }

  it('generateTrialBalance always sums to SUM(DEBITS) = SUM(CREDITS) — master spec §49', async () => {
    const { user } = await setupFixture('k');
    const acc = await accounts(user.organizationId);
    const entry1 = await AccountingService.createJournalEntry(
      user.organizationId,
      entryInput({ lines: [{ accountId: acc.get('Cash')!.id, debit: '1000.00', credit: '0' }, { accountId: acc.get("Owner's Equity")!.id, debit: '0', credit: '1000.00' }] }),
      user.id,
    );
    await AccountingService.postJournalEntry(user.organizationId, entry1.id, user.id);
    const entry2 = await AccountingService.createJournalEntry(
      user.organizationId,
      entryInput({ lines: [{ accountId: acc.get('Rent')!.id, debit: '300.00', credit: '0' }, { accountId: acc.get('Cash')!.id, debit: '0', credit: '300.00' }] }),
      user.id,
    );
    await AccountingService.postJournalEntry(user.organizationId, entry2.id, user.id);

    const trialBalance = await AccountingService.generateTrialBalance(user.organizationId);
    expect(trialBalance.isBalanced).toBe(true);
    expect(trialBalance.totalDebits.toString()).toBe(trialBalance.totalCredits.toString());

    const cashRow = trialBalance.accounts.find((r) => r.name === 'Cash')!;
    expect(cashRow.balance.toFixed(2)).toBe('700.00'); // 1000 debit - 300 credit, Cash is normally DEBIT
  });

  it('a DRAFT entry excludes itself from the trial balance (only POSTED entries count)', async () => {
    const { user } = await setupFixture('l');
    const acc = await accounts(user.organizationId);
    await AccountingService.createJournalEntry(
      user.organizationId,
      entryInput({ lines: [{ accountId: acc.get('Cash')!.id, debit: '1000.00', credit: '0' }, { accountId: acc.get("Owner's Equity")!.id, debit: '0', credit: '1000.00' }] }),
      user.id,
    );
    const trialBalance = await AccountingService.generateTrialBalance(user.organizationId);
    expect(trialBalance.totalDebits.toFixed(2)).toBe('0.00');
  });

  it('refuses to close a period that still has a DRAFT entry dated inside it', async () => {
    const { user } = await setupFixture('m');
    const acc = await accounts(user.organizationId);
    const entry = await AccountingService.createJournalEntry(
      user.organizationId,
      entryInput({ lines: [{ accountId: acc.get('Cash')!.id, debit: '1.00', credit: '0' }, { accountId: acc.get("Owner's Equity")!.id, debit: '0', credit: '1.00' }] }),
      user.id,
    );
    await expect(AccountingService.closePeriod(user.organizationId, entry.periodId, user.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('closes a period once all its entries are posted, and refuses further postings into it', async () => {
    const { user } = await setupFixture('n');
    const acc = await accounts(user.organizationId);
    const entry = await AccountingService.createJournalEntry(
      user.organizationId,
      entryInput({ lines: [{ accountId: acc.get('Cash')!.id, debit: '1.00', credit: '0' }, { accountId: acc.get("Owner's Equity")!.id, debit: '0', credit: '1.00' }] }),
      user.id,
    );
    await AccountingService.postJournalEntry(user.organizationId, entry.id, user.id);
    const closed = await AccountingService.closePeriod(user.organizationId, entry.periodId, user.id);
    expect(closed.status).toBe('CLOSED');

    await expect(
      AccountingService.createJournalEntry(
        user.organizationId,
        entryInput({ entryDate: entry.entryDate.toISOString(), lines: [{ accountId: acc.get('Cash')!.id, debit: '5.00', credit: '0' }, { accountId: acc.get("Owner's Equity")!.id, debit: '0', credit: '5.00' }] }),
        user.id,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('AccountingService — vendors, expense categories, and expense approval', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects a duplicate vendor name within the same organization', async () => {
    const { user } = await setupFixture('o');
    await AccountingService.createVendor(user.organizationId, { name: 'Meralco' }, user.id);
    await expect(AccountingService.createVendor(user.organizationId, { name: 'Meralco' }, user.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('an expense category can have its default account cleared with an explicit null', async () => {
    const { user } = await setupFixture('p');
    const accounts = await AccountingService.listAccounts(user.organizationId, {});
    const rent = accounts.find((a) => a.name === 'Rent')!;
    const category = await AccountingService.createExpenseCategory(user.organizationId, { name: 'Rent', defaultAccountId: rent.id }, user.id);
    expect(category.defaultAccountId).toBe(rent.id);
    const cleared = await AccountingService.updateExpenseCategory(user.organizationId, category.id, { defaultAccountId: null }, user.id);
    expect(cleared.defaultAccountId).toBeNull();
  });

  it('approving an expense posts Debit category-account / Credit Cash (for a CASH expense)', async () => {
    const { user } = await setupFixture('q');
    const branch = await BranchService.create(user.organizationId, { name: 'Branch A', timezone: 'Asia/Manila' }, user.id);
    const accounts = await AccountingService.listAccounts(user.organizationId, {});
    const rent = accounts.find((a) => a.name === 'Rent')!;
    const cash = accounts.find((a) => a.name === 'Cash')!;
    const category = await AccountingService.createExpenseCategory(user.organizationId, { name: 'Rent', defaultAccountId: rent.id }, user.id);
    const expense = await AccountingService.createExpense(
      user.organizationId, branch.id,
      { categoryId: category.id, amount: '5000.00', expenseDate: new Date().toISOString(), paymentMethod: 'CASH' },
      user.id,
    );
    expect(expense.approvalStatus).toBe('PENDING');

    const approved = await AccountingService.approveExpense(user.organizationId, branch.id, expense.id, user.id);
    expect(approved.approvalStatus).toBe('APPROVED');
    expect(approved.journalEntryId).toBeTruthy();

    const entry = await AccountingService.getJournalEntry(user.organizationId, approved.journalEntryId!);
    expect(entry.status).toBe('POSTED');
    const rentLine = entry.lines.find((l) => l.accountId === rent.id)!;
    const cashLine = entry.lines.find((l) => l.accountId === cash.id)!;
    expect(rentLine.debit.toFixed(2)).toBe('5000.00');
    expect(cashLine.credit.toFixed(2)).toBe('5000.00');

    await expect(AccountingService.approveExpense(user.organizationId, branch.id, expense.id, user.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses to approve an expense whose category has no default account configured — never invents one', async () => {
    const { user } = await setupFixture('r');
    const branch = await BranchService.create(user.organizationId, { name: 'Branch A', timezone: 'Asia/Manila' }, user.id);
    const category = await AccountingService.createExpenseCategory(user.organizationId, { name: 'Marketing' }, user.id);
    const expense = await AccountingService.createExpense(
      user.organizationId, branch.id,
      { categoryId: category.id, amount: '1000.00', expenseDate: new Date().toISOString(), paymentMethod: 'CASH' },
      user.id,
    );
    await expect(AccountingService.approveExpense(user.organizationId, branch.id, expense.id, user.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejecting an expense marks it REJECTED without touching the ledger', async () => {
    const { user } = await setupFixture('s');
    const branch = await BranchService.create(user.organizationId, { name: 'Branch A', timezone: 'Asia/Manila' }, user.id);
    const category = await AccountingService.createExpenseCategory(user.organizationId, { name: 'Marketing' }, user.id);
    const expense = await AccountingService.createExpense(
      user.organizationId, branch.id,
      { categoryId: category.id, amount: '1000.00', expenseDate: new Date().toISOString(), paymentMethod: 'CASH' },
      user.id,
    );
    const rejected = await AccountingService.rejectExpense(user.organizationId, branch.id, expense.id, { reason: 'Not a business expense' }, user.id);
    expect(rejected.approvalStatus).toBe('REJECTED');
    expect(rejected.journalEntryId).toBeNull();
    await expect(AccountingService.approveExpense(user.organizationId, branch.id, expense.id, user.id)).rejects.toBeInstanceOf(ConflictError);
  });
});
