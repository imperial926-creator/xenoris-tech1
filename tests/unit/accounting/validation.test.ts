import { describe, it, expect } from 'vitest';
import {
  createAccountSchema,
  listAccountsQuerySchema,
  journalEntryLineInputSchema,
  createJournalEntrySchema,
  updateExpenseCategorySchema,
  createExpenseSchema,
  createVendorSchema,
} from '@/lib/validation/accounting';

describe('createAccountSchema', () => {
  it('accepts a valid custom account', () => {
    const result = createAccountSchema.parse({ code: '6100', name: 'Bank Fees', type: 'EXPENSE' });
    expect(result.code).toBe('6100');
    expect(result.type).toBe('EXPENSE');
  });

  it('rejects an unknown account type', () => {
    expect(createAccountSchema.safeParse({ code: '6100', name: 'Bank Fees', type: 'NOT_A_TYPE' }).success).toBe(false);
  });

  it('rejects a missing code or name', () => {
    expect(createAccountSchema.safeParse({ name: 'Bank Fees', type: 'EXPENSE' }).success).toBe(false);
    expect(createAccountSchema.safeParse({ code: '6100', type: 'EXPENSE' }).success).toBe(false);
  });
});

describe('listAccountsQuerySchema', () => {
  it('transforms the includeInactive string flag into a boolean', () => {
    expect(listAccountsQuerySchema.parse({ includeInactive: 'true' }).includeInactive).toBe(true);
    expect(listAccountsQuerySchema.parse({ includeInactive: 'false' }).includeInactive).toBe(false);
    expect(listAccountsQuerySchema.parse({}).includeInactive).toBe(false);
  });

  it('rejects an unknown account type filter', () => {
    expect(listAccountsQuerySchema.safeParse({ type: 'NOT_A_TYPE' }).success).toBe(false);
  });
});

describe('journalEntryLineInputSchema — the fail-fast mirror of the debit_xor_credit_check DB constraint', () => {
  it('accepts a line with only a debit set', () => {
    const result = journalEntryLineInputSchema.parse({ accountId: 'acc_1', debit: '100.00' });
    expect(result.debit).toBe('100.00');
    expect(result.credit).toBe('0');
  });

  it('accepts a line with only a credit set', () => {
    expect(journalEntryLineInputSchema.safeParse({ accountId: 'acc_1', credit: '100.00' }).success).toBe(true);
  });

  it('rejects a line with both debit and credit positive', () => {
    expect(journalEntryLineInputSchema.safeParse({ accountId: 'acc_1', debit: '100.00', credit: '50.00' }).success).toBe(false);
  });

  it('rejects a line with neither debit nor credit set', () => {
    expect(journalEntryLineInputSchema.safeParse({ accountId: 'acc_1' }).success).toBe(false);
  });

  it('rejects a negative debit', () => {
    expect(journalEntryLineInputSchema.safeParse({ accountId: 'acc_1', debit: '-5.00' }).success).toBe(false);
  });
});

describe('createJournalEntrySchema', () => {
  const line = (debit: string, credit: string) => ({ accountId: 'acc_1', debit, credit });

  it('requires at least two lines', () => {
    const result = createJournalEntrySchema.safeParse({
      entryDate: '2026-01-01',
      description: 'Test',
      lines: [line('100.00', '0')],
    });
    expect(result.success).toBe(false);
  });

  it('accepts two balanced-looking lines (balance itself is enforced by AccountingService, not this schema)', () => {
    const result = createJournalEntrySchema.safeParse({
      entryDate: '2026-01-01',
      description: 'Test',
      lines: [line('100.00', '0'), line('0', '100.00')],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing description', () => {
    const result = createJournalEntrySchema.safeParse({
      entryDate: '2026-01-01',
      lines: [line('100.00', '0'), line('0', '100.00')],
    });
    expect(result.success).toBe(false);
  });
});

describe('updateExpenseCategorySchema — nullable-clearable defaultAccountId', () => {
  it('accepts an omitted defaultAccountId (leave unchanged)', () => {
    expect(updateExpenseCategorySchema.safeParse({ name: 'Rent' }).success).toBe(true);
  });

  it('accepts a string defaultAccountId (set it)', () => {
    const result = updateExpenseCategorySchema.parse({ defaultAccountId: 'acc_1' });
    expect(result.defaultAccountId).toBe('acc_1');
  });

  it('accepts an explicit null defaultAccountId (clear it)', () => {
    const result = updateExpenseCategorySchema.parse({ defaultAccountId: null });
    expect(result.defaultAccountId).toBeNull();
  });
});

describe('createExpenseSchema', () => {
  it('accepts a valid expense', () => {
    const result = createExpenseSchema.parse({
      categoryId: 'cat_1', amount: '45000.00', expenseDate: '2026-01-01', paymentMethod: 'BANK_TRANSFER',
    });
    expect(result.amount).toBe('45000.00');
  });

  it('rejects a zero or negative amount', () => {
    expect(createExpenseSchema.safeParse({ categoryId: 'cat_1', amount: '0', expenseDate: '2026-01-01', paymentMethod: 'CASH' }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ categoryId: 'cat_1', amount: '-10.00', expenseDate: '2026-01-01', paymentMethod: 'CASH' }).success).toBe(false);
  });

  it('rejects an unknown payment method', () => {
    expect(createExpenseSchema.safeParse({ categoryId: 'cat_1', amount: '10.00', expenseDate: '2026-01-01', paymentMethod: 'CRYPTO' }).success).toBe(false);
  });
});

describe('createVendorSchema', () => {
  it('accepts a name-only vendor', () => {
    expect(createVendorSchema.safeParse({ name: 'Meralco' }).success).toBe(true);
  });

  it('rejects an invalid email', () => {
    expect(createVendorSchema.safeParse({ name: 'Meralco', email: 'not-an-email' }).success).toBe(false);
  });
});
