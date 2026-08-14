-- Phase 5 — Kitchen Display System
--
-- No new tables (see the "Phase 5 — Kitchen Display System" comment block in
-- schema.prisma for why: the master spec's KDS section asks for a dashboard
-- over the existing order lifecycle, not a parallel data model). The only
-- schema change is one nullable column on "orders" for the spec's
-- "Required time" field.

ALTER TABLE "orders" ADD COLUMN "requiredAt" TIMESTAMP(3);
