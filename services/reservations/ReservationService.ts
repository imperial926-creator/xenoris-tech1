import 'server-only';
import { Prisma } from '@prisma/client';
import type { ReservationStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import type {
  AvailabilityQueryInput,
  CreateReservationInput,
  RecordDepositInput,
  UpdateReservationStatusInput,
  ListReservationsQueryInput,
} from '@/lib/validation/reservation';

/**
 * Legal reservation status transitions — same "whitelist, not anything
 * goes" pattern as TableService.ALLOWED_TRANSITIONS. A reservation cannot,
 * for example, jump from PENDING straight to COMPLETED, or be revived out of
 * a terminal state (COMPLETED/CANCELLED/NO_SHOW).
 */
const ALLOWED_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SEATED', 'CANCELLED', 'NO_SHOW'],
  SEATED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

// Statuses that do NOT hold a table (i.e. excluded from the DB's
// no_double_booking constraint via its WHERE clause — see migration SQL).
// ReservationTable rows must be kept in this same set whenever the parent
// Reservation enters one of these statuses, or the table stays falsely
// blocked forever.
const TABLE_FREEING_STATUSES: ReservationStatus[] = ['CANCELLED', 'NO_SHOW'];

const RESERVATION_INCLUDE = {
  tables: { include: { table: true } },
} satisfies Prisma.ReservationInclude;

export class ReservationService {
  /**
   * Finds tables at a branch that can seat `guestCount` and have no
   * overlapping (non-cancelled/no-show) booking for the requested window.
   * Mirrors the exact overlap logic the DB EXCLUDE constraint enforces
   * (start1 < end2 AND end1 > start2, i.e. half-open range intersection) so
   * the UI's "available" list and the database's final word on the subject
   * never disagree.
   */
  static async findAvailableTables(
    organizationId: string,
    branchId: string,
    query: AvailabilityQueryInput,
  ) {
    await this.assertBranchInOrg(organizationId, branchId);
    const { startAt, endAt } = this.resolveWindow(query.startAt, query.durationMinutes);
    await this.assertWithinBusinessHours(branchId, startAt, endAt);

    return prisma.restaurantTable.findMany({
      where: {
        organizationId,
        branchId,
        active: true,
        status: { not: 'OUT_OF_SERVICE' },
        capacity: { gte: query.guestCount },
        reservationTables: {
          none: {
            status: { notIn: TABLE_FREEING_STATUSES },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
        },
      },
      include: { section: true },
      orderBy: [{ capacity: 'asc' }, { tableNumber: 'asc' }],
    });
  }

  static async list(organizationId: string, branchId: string, query: ListReservationsQueryInput) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.reservation.findMany({
      where: {
        organizationId,
        branchId,
        status: query.status,
        ...(query.from || query.to
          ? {
              startAt: {
                gte: query.from ? new Date(query.from) : undefined,
                lte: query.to ? new Date(query.to) : undefined,
              },
            }
          : {}),
      },
      include: RESERVATION_INCLUDE,
      orderBy: { startAt: 'asc' },
    });
  }

  static async get(organizationId: string, branchId: string, reservationId: string) {
    const reservation = await prisma.reservation.findFirst({
      where: { id: reservationId, branchId, organizationId },
      include: RESERVATION_INCLUDE,
    });
    if (!reservation) throw new NotFoundError('Reservation');
    return reservation;
  }

  static async getStatusHistory(organizationId: string, branchId: string, reservationId: string) {
    await this.get(organizationId, branchId, reservationId);
    return prisma.reservationStatusHistory.findMany({
      where: { reservationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Creates a reservation and assigns it to one or more tables in a single
   * transaction. The actual double-booking rejection is enforced by
   * Postgres (the `no_double_booking` EXCLUDE constraint on
   * reservation_tables — see prisma/migrations/*_phase3_reservations); this
   * method also does an application-level availability check first purely
   * to return a clear, specific error message instead of a raw constraint
   * violation whenever possible. Both layers matter: the app check can race
   * (TOCTOU) under concurrent requests, so the DB constraint is the real
   * guarantee — proven with a genuine concurrent-session test, see
   * docs/database.md.
   */
  static async createReservation(
    organizationId: string,
    branchId: string,
    input: CreateReservationInput,
    actorUserId: string,
  ) {
    await this.assertBranchInOrg(organizationId, branchId);
    const { startAt, endAt } = this.resolveWindow(input.startAt, input.durationMinutes);
    if (startAt <= new Date(Date.now() - 5 * 60 * 1000)) {
      // Small grace window rather than a hard ">= now" check, so a request
      // that started a few seconds before submission doesn't get rejected.
      throw new ConflictError('Reservation start time cannot be in the past.');
    }
    await this.assertWithinBusinessHours(branchId, startAt, endAt);

    const tables = await prisma.restaurantTable.findMany({
      where: { id: { in: input.tableIds }, organizationId, branchId },
    });
    if (tables.length !== input.tableIds.length) {
      throw new NotFoundError('One or more selected tables');
    }
    const totalCapacity = tables.reduce((sum, t) => sum + t.capacity, 0);
    if (totalCapacity < input.guestCount) {
      throw new ConflictError(
        `Selected tables seat ${totalCapacity} total, which is less than the party size of ${input.guestCount}.`,
      );
    }
    if (input.customerUserId) {
      const customer = await prisma.user.findFirst({
        where: { id: input.customerUserId, organizationId },
      });
      if (!customer) throw new NotFoundError('Customer account');
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const reservation = await tx.reservation.create({
          data: {
            organizationId,
            branchId,
            customerUserId: input.customerUserId,
            guestName: input.guestName,
            guestEmail: input.guestEmail,
            guestPhone: input.guestPhone,
            startAt,
            endAt,
            guestCount: input.guestCount,
            specialRequests: input.specialRequests,
            occasion: input.occasion,
            depositRequired: input.depositRequired,
            depositAmount: input.depositAmount,
            depositStatus: input.depositRequired ? 'PENDING' : 'NONE',
            depositNote: input.depositNote,
          },
        });

        for (const table of tables) {
          await tx.reservationTable.create({
            data: {
              reservationId: reservation.id,
              tableId: table.id,
              startAt,
              endAt,
              status: reservation.status,
            },
          });
        }

        await tx.reservationStatusHistory.create({
          data: { reservationId: reservation.id, fromStatus: null, toStatus: reservation.status, changedByUserId: actorUserId },
        });

        await writeAuditLog(tx, {
          organizationId,
          branchId,
          userId: actorUserId,
          action: 'reservation.create',
          entityType: 'Reservation',
          entityId: reservation.id,
          newValue: { ...reservation, tableIds: input.tableIds },
        });

        return tx.reservation.findUniqueOrThrow({
          where: { id: reservation.id },
          include: RESERVATION_INCLUDE,
        });
      });
    } catch (error) {
      throw this.translateDbError(error);
    }
  }

  /**
   * Transitions a reservation's status, validating against
   * ALLOWED_TRANSITIONS, mirroring the status onto every assigned
   * reservation_tables row (required for the exclusion constraint to
   * correctly free the table on cancellation/no-show), and recording the
   * change in reservation_status_history.
   */
  static async updateStatus(
    organizationId: string,
    branchId: string,
    reservationId: string,
    input: UpdateReservationStatusInput,
    actorUserId: string,
  ) {
    const reservation = await this.get(organizationId, branchId, reservationId);

    if (reservation.status === input.status) {
      return reservation;
    }

    const allowed = ALLOWED_TRANSITIONS[reservation.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Cannot move reservation from ${reservation.status} to ${input.status}. Allowed next states: ${allowed.join(', ') || 'none'}.`,
      );
    }
    if (input.status === 'CANCELLED' && !input.cancellationReason) {
      throw new ConflictError('cancellationReason is required when cancelling a reservation.');
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: input.status,
          cancellationReason: input.status === 'CANCELLED' ? input.cancellationReason : reservation.cancellationReason,
          cancelledAt: input.status === 'CANCELLED' ? new Date() : reservation.cancelledAt,
        },
      });

      // Keep the denormalized status on every assigned table row in sync —
      // this is what actually frees the table for rebooking once cancelled
      // or no-showed (see TABLE_FREEING_STATUSES / the migration's WHERE
      // clause on no_double_booking).
      await tx.reservationTable.updateMany({
        where: { reservationId },
        data: { status: input.status },
      });

      await tx.reservationStatusHistory.create({
        data: {
          reservationId,
          fromStatus: reservation.status,
          toStatus: input.status,
          changedByUserId: actorUserId,
          note: input.note,
        },
      });

      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'reservation.status_change',
        entityType: 'Reservation',
        entityId: reservationId,
        previousValue: { status: reservation.status },
        newValue: { status: input.status, note: input.note, cancellationReason: input.cancellationReason },
      });

      return tx.reservation.findUniqueOrThrow({
        where: { id: updated.id },
        include: RESERVATION_INCLUDE,
      });
    });
  }

  /**
   * Manually records a deposit payment/refund. There is no payment gateway
   * yet (see docs/architecture.md § Risks) — this is staff attesting money
   * changed hands outside the system (cash, bank transfer, etc.), not a
   * real transaction record. Phase 4/10 will connect this to a real ledger.
   */
  static async recordDeposit(
    organizationId: string,
    branchId: string,
    reservationId: string,
    input: RecordDepositInput,
    actorUserId: string,
  ) {
    const reservation = await this.get(organizationId, branchId, reservationId);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.reservation.update({
        where: { id: reservationId },
        data: {
          depositRequired: true,
          depositAmount: input.depositAmount ?? reservation.depositAmount ?? undefined,
          depositStatus: input.depositStatus,
          depositNote: input.depositNote,
        },
      });

      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'reservation.deposit_recorded',
        entityType: 'Reservation',
        entityId: reservationId,
        previousValue: {
          depositStatus: reservation.depositStatus,
          depositAmount: reservation.depositAmount,
        },
        newValue: {
          depositStatus: updated.depositStatus,
          depositAmount: updated.depositAmount,
          note: input.depositNote,
        },
      });

      return updated;
    });
  }

  // --- helpers ------------------------------------------------------------

  private static resolveWindow(startAtRaw: string, durationMinutes: number) {
    const startAt = new Date(startAtRaw);
    if (Number.isNaN(startAt.getTime())) {
      throw new ConflictError('startAt is not a valid date/time.');
    }
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
    return { startAt, endAt };
  }

  /**
   * Soft business-hours check against Branch.openingHours (added in Phase
   * 1/2). Uses Intl.DateTimeFormat with the branch's IANA timezone instead
   * of a date library — date-fns-tz is declared in package.json but this
   * build environment cannot run `npm install`, so anything on the request
   * path avoids depending on code that has never actually been resolved
   * (see CLAUDE.md → Known Issues). If a branch has no openingHours
   * configured for that day, the check is skipped rather than blocking
   * bookings on missing configuration.
   */
  private static async assertWithinBusinessHours(branchId: string, startAt: Date, endAt: Date) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch?.openingHours) return;

    const hours = branch.openingHours as Record<
      string,
      { open: string; close: string; closed?: boolean }
    >;
    const dayKey = this.dayKeyInTimezone(startAt, branch.timezone);
    const day = hours[dayKey];
    if (!day) return; // No configuration for this day — nothing to enforce.
    if (day.closed) {
      throw new ConflictError(`The branch is closed on ${dayKey}.`);
    }

    const startMinutes = this.minutesSinceMidnightInTimezone(startAt, branch.timezone);
    const endMinutes = this.minutesSinceMidnightInTimezone(endAt, branch.timezone);
    const openMinutes = this.parseHHMM(day.open);
    const closeMinutes = this.parseHHMM(day.close);
    if (openMinutes === null || closeMinutes === null) return;

    // Reservations that cross midnight (endMinutes wraps to a smaller number
    // than startMinutes) are out of scope for this simple check — flagged
    // rather than silently mishandled.
    if (endMinutes < startMinutes) return;

    if (startMinutes < openMinutes || endMinutes > closeMinutes) {
      throw new ConflictError(
        `Requested time is outside business hours (${day.open}–${day.close} on ${dayKey}).`,
      );
    }
  }

  private static dayKeyInTimezone(date: Date, timezone: string): string {
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
      .format(date)
      .toLowerCase();
    // Intl gives "mon", "tue", ... "sun" for en-US 'short' — matches
    // openingHoursSchema's day keys exactly.
    return weekday;
  }

  private static minutesSinceMidnightInTimezone(date: Date, timezone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    // Intl can render midnight as "24:00" for hour12:false — normalize.
    return (hour % 24) * 60 + minute;
  }

  private static parseHHMM(value: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  private static async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }

  /**
   * The `no_double_booking` EXCLUDE constraint (see migration SQL) has no
   * representation in Prisma's schema DSL, so Prisma cannot map it to a
   * typed error the way it does `@@unique`/`@@id` violations (P2002, etc.).
   * It surfaces as a generic PrismaClientUnknownRequestError carrying the
   * raw Postgres error text. This translates that specific, known case into
   * the same ConflictError every other "someone already took this" path
   * throws — anything else is rethrown unchanged, not swallowed.
   */
  private static translateDbError(error: unknown): unknown {
    if (error instanceof Error && error.message.includes('no_double_booking')) {
      return new ConflictError(
        'One or more selected tables are already booked for an overlapping time window.',
      );
    }
    return error;
  }
}
