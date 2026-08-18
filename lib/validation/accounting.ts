import { z } from 'zod';

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE'] as const;
export const DEBIT_CREDIT = ['DEBIT', 'CREDIT'] as const;
// Phase 11 — see ChartOfAccount.cashFlowCategory in schema.prisma.
export const CASH_FLOW_CATEGORIES = ['OPERATING', 'INVESTING', 'FINANCING'] as const;
export const ACCOUNTING_PERIOD_STATUSES = ['OPEN', 'CLOSED'] as const;
export const JOURNAL_ENTRY_STATUSES = ['DRAFT', 'POSTED', 'REVERSED'] as const;
export const EXPENSE_APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
// Reused from lib/validation/order.ts's ORDER_PAYMENT_METHODS — Expense
// deliberately shares the same enum value set (see schema.prisma's "Phase
// 10 — Accounting" comment block, decision #6's sibling reasoning).
export const EXPENSE_PAYMENT_METHODS = ['CASH', 'CARD', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'] as const;

// Same 2-decimal-place money pattern as lib/validation/order.ts's
// moneyString — ledger amounts are always whole-centavo PHP values.
const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Must be a non-negative monetary value with up to 2 decimal places.');

const positiveMoneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0, 'Must be a positive monetary value with up to 2 decimal places.');

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

export const createAccountSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(150),
  type: z.enum(ACCOUNT_TYPES),
  description: z.string().trim().max(500).optional(),
  // Optional override — AccountingService.createAccount falls back to a
  // sensible per-type default (see DEFAULT_CASH_FLOW_CATEGORY_BY_TYPE) when
  // omitted. Not exposed: isCashEquivalent — see createAccount's comment.
  cashFlowCategory: z.enum(CASH_FLOW_CATEGORIES).optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().max(500).optional(),
  active: z.boolean().optional(),
  cashFlowCategory: z.enum(CASH_FLOW_CATEGORIES).nullable().optional(),
  isCashEquivalent: z.boolean().optional(),
});
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const listAccountsQuerySchema = z.object({
  type: z.enum(ACCOUNT_TYPES).optional(),
  includeInactive: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListAccountsQueryInput = z.infer<typeof listAccountsQuerySchema>;

// ---------------------------------------------------------------------------
// Journal entries
// ---------------------------------------------------------------------------

export const journalEntryLineInputSchema = z.object({
  accountId: z.string().trim().min(1),
  // Exactly one of debit/credit must be a positive amount — mirrors the
  // database CHECK constraint (journal_entry_lines_debit_xor_credit_check)
  // as a fail-fast, friendlier-error-message layer in front of it.
  debit: moneyString.default('0'),
  credit: moneyString.default('0'),
  description: z.string().trim().max(300).optional(),
}).refine(
  (line) => {
    const debit = Number(line.debit);
    const credit = Number(line.credit);
    return (debit > 0 && credit === 0) || (credit > 0 && debit === 0);
  },
  { message: 'Each line must have exactly one of debit or credit set to a positive amount, never both, never neither.' },
);
export type JournalEntryLineInput = z.infer<typeof journalEntryLineInputSchema>;

export const createJournalEntrySchema = z.object({
  branchId: z.string().trim().min(1).optional(),
  entryDate: z.string().trim().min(1),
  description: z.string().trim().min(1).max(500),
  lines: z.array(journalEntryLineInputSchema).min(2, 'A journal entry needs at least two lines (at least one debit and one credit).'),
});
export type CreateJournalEntryInput = z.infer<typeof createJournalEntrySchema>;

export const listJournalEntriesQuerySchema = z.object({
  branchId: z.string().trim().min(1).optional(),
  status: z.enum(JOURNAL_ENTRY_STATUSES).optional(),
  accountId: z.string().trim().min(1).optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
});
export type ListJournalEntriesQueryInput = z.infer<typeof listJournalEntriesQuerySchema>;

export const reverseJournalEntrySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ReverseJournalEntryInput = z.infer<typeof reverseJournalEntrySchema>;

// ---------------------------------------------------------------------------
// Accounting periods
// ---------------------------------------------------------------------------

export const trialBalanceQuerySchema = z.object({
  asOfDate: z.string().trim().min(1).optional(),
});
export type TrialBalanceQueryInput = z.infer<typeof trialBalanceQuerySchema>;

// ---------------------------------------------------------------------------
// Expenses / vendors / categories
// ---------------------------------------------------------------------------

export const createVendorSchema = z.object({
  name: z.string().trim().min(1).max(150),
  contactName: z.string().trim().max(150).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(400).optional(),
});
export type CreateVendorInput = z.infer<typeof createVendorSchema>;

export const updateVendorSchema = createVendorSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;

export const createExpenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(150),
  defaultAccountId: z.string().trim().min(1).optional(),
});
export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;

export const updateExpenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  defaultAccountId: z.union([z.string().trim().min(1), z.null()]).optional(),
  active: z.boolean().optional(),
});
export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategorySchema>;

export const createExpenseSchema = z.object({
  vendorId: z.string().trim().min(1).optional(),
  categoryId: z.string().trim().min(1),
  amount: positiveMoneyString,
  expenseDate: z.string().trim().min(1),
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS),
  notes: z.string().trim().max(500).optional(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const rejectExpenseSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RejectExpenseInput = z.infer<typeof rejectExpenseSchema>;

export const listExpensesQuerySchema = z.object({
  approvalStatus: z.enum(EXPENSE_APPROVAL_STATUSES).optional(),
  categoryId: z.string().trim().min(1).optional(),
  vendorId: z.string().trim().min(1).optional(),
});
export type ListExpensesQueryInput = z.infer<typeof listExpensesQuerySchema>;

export const addExpenseAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  // Phase 15 hardening: was a bare non-empty string, which would accept a
  // `javascript:`/`data:` URL. This model is metadata-only today — there is
  // no real upload/storage integration yet (STORAGE_PROVIDER_KEY is
  // unconfigured, see .env.example), so nothing currently renders this
  // value as a clickable link — but validating the shape now means a
  // future storage integration doesn't inherit a stored-XSS-shaped hole.
  // Restricted to https: only; real uploads will always be served from an
  // https object-storage URL.
  fileUrl: z.string().trim().max(2000).url().refine((v) => v.startsWith('https://'), 'fileUrl must be an https:// URL.'),
});
export type AddExpenseAttachmentInput = z.infer<typeof addExpenseAttachmentSchema>;
