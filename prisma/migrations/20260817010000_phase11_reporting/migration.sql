-- Phase 11 migration: Financial Reporting. Hand-authored to match
-- prisma/schema.prisma, same reason as every prior migration in this repo
-- -- no network access to run `prisma migrate dev` here.
--
-- Adds only two columns to the existing chart_of_accounts table (no new
-- tables -- Phase 11's income statement/balance sheet/cash flow/dashboard
-- are pure read/aggregation over Phase 10's ledger). The addition exists
-- to give the Cash Flow Statement's direct method (master spec §35) an
-- explicit, auditable classification instead of guessing from account
-- name/type at report time -- see ChartOfAccount's schema.prisma comments
-- and ReportingService.generateCashFlow's file header for the reasoning.

CREATE TYPE "CashFlowCategory" AS ENUM ('OPERATING', 'INVESTING', 'FINANCING');

ALTER TABLE "chart_of_accounts"
  ADD COLUMN "isCashEquivalent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cashFlowCategory" "CashFlowCategory";
