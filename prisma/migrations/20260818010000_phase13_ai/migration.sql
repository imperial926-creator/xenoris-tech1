-- Phase 13 migration: AI Business Intelligence. Hand-authored to match
-- prisma/schema.prisma, same reason as every prior migration in this repo
-- -- no network access to run `prisma migrate dev` here.
--
-- Adds only one nullable column to the existing organizations table (no
-- new tables -- Phase 13's insight engine is pure read/aggregation over
-- data already produced by Phases 9-12, via lib/ai/tools.ts). The column
-- lets an organization override the default insight-generation thresholds
-- in lib/ai/thresholds.ts (e.g. what counts as a "significant" margin
-- swing), the same "nullable Json, code supplies the default" pattern
-- Phase 8 already established for organizations.crmSettings.

ALTER TABLE "organizations"
  ADD COLUMN "aiSettings" JSONB;
