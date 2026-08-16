-- Phase 10 migration: Accounting. Hand-authored to match prisma/schema.prisma,
-- same reason as every prior migration in this repo -- no network access to
-- run `prisma migrate dev` here.
--
-- Adds the double-entry ledger (chart_of_accounts, accounting_periods,
-- journal_entries, journal_entry_lines -- master spec §27/§28), the
-- idempotency/link layer (financial_transactions -- §47), and expense
-- tracking (expense_categories, vendors, expenses, expense_attachments --
-- §30). See the "Phase 10 — Accounting" comment block in schema.prisma for
-- the six numbered design decisions in full.

-- Enums
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE');
CREATE TYPE "DebitCredit" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');
CREATE TYPE "FinancialTransactionType" AS ENUM ('ORDER_REVENUE', 'ORDER_COGS', 'DEPOSIT_RECEIVED', 'DEPOSIT_REFUNDED', 'DEPOSIT_EARNED', 'INVENTORY_PURCHASE', 'INVENTORY_WASTE', 'EXPENSE_POSTED');
CREATE TYPE "ExpenseApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- chart_of_accounts
CREATE TABLE "chart_of_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "normalBalance" "DebitCredit" NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chart_of_accounts_organizationId_code_key" ON "chart_of_accounts"("organizationId", "code");
CREATE UNIQUE INDEX "chart_of_accounts_organizationId_name_key" ON "chart_of_accounts"("organizationId", "name");
CREATE INDEX "chart_of_accounts_organizationId_idx" ON "chart_of_accounts"("organizationId");

-- accounting_periods
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_periods_organizationId_startDate_key" ON "accounting_periods"("organizationId", "startDate");
CREATE INDEX "accounting_periods_organizationId_idx" ON "accounting_periods"("organizationId");

-- journal_entries
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "periodId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "reversalOfEntryId" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "journal_entries_reversalOfEntryId_key" ON "journal_entries"("reversalOfEntryId");
CREATE INDEX "journal_entries_organizationId_idx" ON "journal_entries"("organizationId");
CREATE INDEX "journal_entries_branchId_idx" ON "journal_entries"("branchId");
CREATE INDEX "journal_entries_periodId_idx" ON "journal_entries"("periodId");
CREATE INDEX "journal_entries_referenceType_referenceId_idx" ON "journal_entries"("referenceType", "referenceId");

-- journal_entry_lines
CREATE TABLE "journal_entry_lines" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id"),
    -- Exactly one side populated and positive, never both, never neither.
    -- No Prisma schema DSL support for CHECK constraints (same gap Phase 3/
    -- 4/8's CHECK constraints hit) — enforced here, plus a matching
    -- Zod-layer bound in lib/validation/accounting.ts.
    CONSTRAINT "journal_entry_lines_debit_xor_credit_check" CHECK (
        ("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)
    )
);
CREATE INDEX "journal_entry_lines_journalEntryId_idx" ON "journal_entry_lines"("journalEntryId");
CREATE INDEX "journal_entry_lines_accountId_idx" ON "journal_entry_lines"("accountId");

-- financial_transactions
CREATE TABLE "financial_transactions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "type" "FinancialTransactionType" NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "financial_transactions_journalEntryId_key" ON "financial_transactions"("journalEntryId");
CREATE UNIQUE INDEX "financial_transactions_referenceType_referenceId_type_key" ON "financial_transactions"("referenceType", "referenceId", "type");
CREATE INDEX "financial_transactions_organizationId_idx" ON "financial_transactions"("organizationId");

-- expense_categories
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultAccountId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "expense_categories_organizationId_name_key" ON "expense_categories"("organizationId", "name");
CREATE INDEX "expense_categories_organizationId_idx" ON "expense_categories"("organizationId");

-- vendors
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vendors_organizationId_name_key" ON "vendors"("organizationId", "name");
CREATE INDEX "vendors_organizationId_idx" ON "vendors"("organizationId");

-- expenses
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "vendorId" TEXT,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "paymentMethod" "OrderPaymentMethod" NOT NULL,
    "notes" TEXT,
    "approvalStatus" "ExpenseApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "recordedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "expenses_journalEntryId_key" ON "expenses"("journalEntryId");
CREATE INDEX "expenses_organizationId_idx" ON "expenses"("organizationId");
CREATE INDEX "expenses_branchId_idx" ON "expenses"("branchId");
CREATE INDEX "expenses_categoryId_idx" ON "expenses"("categoryId");

-- expense_attachments
CREATE TABLE "expense_attachments" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expense_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "expense_attachments_expenseId_idx" ON "expense_attachments"("expenseId");

-- Foreign keys

ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfEntryId_fkey" FOREIGN KEY ("reversalOfEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_defaultAccountId_fkey" FOREIGN KEY ("defaultAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
