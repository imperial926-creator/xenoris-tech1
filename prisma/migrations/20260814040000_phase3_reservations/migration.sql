-- Phase 3 migration: reservations, reservation<->table assignment, and
-- reservation status history. Hand-authored to match prisma/schema.prisma
-- for the same reason as the Phase 1/2 migrations — no network access to run
-- `prisma migrate dev` in this build environment.
--
-- This migration also adds a Postgres-level double-booking guard that has no
-- representation in schema.prisma (Prisma's DSL has no EXCLUDE constraint
-- support) — see the "Phase 3 — Reservations" comment block in
-- schema.prisma and docs/database.md for the full rationale.

-- Enums
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
CREATE TYPE "ReservationDepositStatus" AS ENUM ('NONE', 'PENDING', 'PAID', 'REFUNDED');

-- reservations
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerUserId" TEXT,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "guestCount" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "specialRequests" TEXT,
    "occasion" TEXT,
    "depositRequired" BOOLEAN NOT NULL DEFAULT false,
    "depositAmount" DECIMAL(10,2),
    "depositStatus" "ReservationDepositStatus" NOT NULL DEFAULT 'NONE',
    "depositNote" TEXT,
    "cancellationReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reservations_organizationId_idx" ON "reservations"("organizationId");
CREATE INDEX "reservations_branchId_startAt_idx" ON "reservations"("branchId", "startAt");
CREATE INDEX "reservations_customerUserId_idx" ON "reservations"("customerUserId");

-- reservation_tables
CREATE TABLE "reservation_tables" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reservation_tables_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reservation_tables_reservationId_tableId_key" ON "reservation_tables"("reservationId", "tableId");
CREATE INDEX "reservation_tables_tableId_idx" ON "reservation_tables"("tableId");
CREATE INDEX "reservation_tables_reservationId_idx" ON "reservation_tables"("reservationId");

-- reservation_status_history
CREATE TABLE "reservation_status_history" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "fromStatus" "ReservationStatus",
    "toStatus" "ReservationStatus" NOT NULL,
    "changedByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reservation_status_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reservation_status_history_reservationId_createdAt_idx" ON "reservation_status_history"("reservationId", "createdAt");

-- Foreign keys
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reservation_tables" ADD CONSTRAINT "reservation_tables_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reservation_tables" ADD CONSTRAINT "reservation_tables_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "restaurant_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reservation_status_history" ADD CONSTRAINT "reservation_status_history_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Double-booking prevention (DB-enforced, not just application logic)
-- ---------------------------------------------------------------------------
-- btree_gist lets a plain equality column (tableId) participate in a GiST
-- exclusion constraint alongside a range type (tsrange of startAt/endAt).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Reject any two rows for the same table whose [startAt, endAt) ranges
-- overlap, UNLESS at least one of them is CANCELLED or NO_SHOW (a cancelled
-- slot must not block rebooking the table). This runs inside Postgres on
-- every insert/update to reservation_tables — it cannot be bypassed by a
-- race condition, a bug in ReservationService, or a direct SQL client.
ALTER TABLE "reservation_tables" ADD CONSTRAINT "no_double_booking"
    EXCLUDE USING gist (
        "tableId" WITH =,
        tsrange("startAt", "endAt") WITH &&
    )
    WHERE (status NOT IN ('CANCELLED', 'NO_SHOW'));
