-- Phase 15 hardening (database + financial-integrity review). Hand-authored
-- to match prisma/schema.prisma, same reason as every prior migration in
-- this repo -- no network access to run `prisma migrate dev` here.
--
-- Three kinds of change, none of which touch existing data:
--   1. Branch-scoped financial/audit-trail FKs: CASCADE -> RESTRICT, so
--      deleting a branch can never silently delete or orphan ledger rows.
--      A branch with financial history must be deactivated, not deleted.
--   2. CHECK constraints the app-layer Zod validation already enforces,
--      now also enforced at the DB level as the real guarantee under a
--      direct DB write or a future code path that skips the service layer.
--   3. Seven @@unique([...,'name']) constraints converted to partial
--      unique indexes (WHERE active), so a name can be reused after the
--      original row is deactivated. MenuModifierGroup was audited too but
--      has no `active` column (no soft-delete concept), so its plain
--      unique constraint is correct as-is and is intentionally left alone.

-- ---------------------------------------------------------------------------
-- 1. Branch FK: CASCADE -> RESTRICT on financial/audit-trail child tables
-- ---------------------------------------------------------------------------

ALTER TABLE "invoices" DROP CONSTRAINT "invoices_branchId_fkey";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "catering_payments" DROP CONSTRAINT "catering_payments_branchId_fkey";
ALTER TABLE "catering_payments" ADD CONSTRAINT "catering_payments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_transactions" DROP CONSTRAINT "inventory_transactions_branchId_fkey";
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_branchId_fkey";
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "waste_records" DROP CONSTRAINT "waste_records_branchId_fkey";
ALTER TABLE "waste_records" ADD CONSTRAINT "waste_records_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_branchId_fkey";
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_transactions" DROP CONSTRAINT "financial_transactions_branchId_fkey";
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expenses" DROP CONSTRAINT "expenses_branchId_fkey";
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- JournalEntry.reversalOfEntryId: SET NULL -> RESTRICT — deleting the
-- original entry must never silently detach its reversal.
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_reversalOfEntryId_fkey";
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfEntryId_fkey" FOREIGN KEY ("reversalOfEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. CHECK constraints
-- ---------------------------------------------------------------------------

ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_capacity_check" CHECK ("capacity" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "catering_packages" ADD CONSTRAINT "catering_packages_guest_bounds_check" CHECK (
  ("minGuests" IS NULL OR "minGuests" > 0)
  AND ("maxGuests" IS NULL OR "maxGuests" > 0)
  AND ("minGuests" IS NULL OR "maxGuests" IS NULL OR "maxGuests" >= "minGuests")
);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_check" CHECK ("amount" > 0);

-- ---------------------------------------------------------------------------
-- 3. Partial unique indexes (WHERE active) replacing plain @@unique([...,'name'])
-- ---------------------------------------------------------------------------

DROP INDEX "table_sections_branchId_name_key";
CREATE UNIQUE INDEX "table_sections_branchId_name_active_key" ON "table_sections"("branchId", "name") WHERE ("active");

DROP INDEX "menu_categories_organizationId_name_key";
CREATE UNIQUE INDEX "menu_categories_organizationId_name_active_key" ON "menu_categories"("organizationId", "name") WHERE ("active");

DROP INDEX "delivery_zones_branchId_name_key";
CREATE UNIQUE INDEX "delivery_zones_branchId_name_active_key" ON "delivery_zones"("branchId", "name") WHERE ("active");

DROP INDEX "catering_packages_branchId_name_key";
CREATE UNIQUE INDEX "catering_packages_branchId_name_active_key" ON "catering_packages"("branchId", "name") WHERE ("active");

DROP INDEX "suppliers_organizationId_name_key";
CREATE UNIQUE INDEX "suppliers_organizationId_name_active_key" ON "suppliers"("organizationId", "name") WHERE ("active");

DROP INDEX "expense_categories_organizationId_name_key";
CREATE UNIQUE INDEX "expense_categories_organizationId_name_active_key" ON "expense_categories"("organizationId", "name") WHERE ("active");

DROP INDEX "vendors_organizationId_name_key";
CREATE UNIQUE INDEX "vendors_organizationId_name_active_key" ON "vendors"("organizationId", "name") WHERE ("active");
