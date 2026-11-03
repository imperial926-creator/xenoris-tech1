import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { TableService } from '@/services/tables/TableService';
import { ReservationService } from '@/services/reservations/ReservationService';
import { resetDatabase } from '../../helpers/db';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';

async function setupOrgWithBranch(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Reservation Test ${suffix}`,
    organizationEmail: `reservation-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@reservation-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  const branch = await BranchService.create(
    user.organizationId,
    { name: `Branch ${suffix}`, timezone: 'Asia/Manila' },
    user.id,
  );
  return { user, branch };
}

async function createTable(
  user: { organizationId: string; id: string },
  branch: { id: string },
  tableNumber = 'T1',
  capacity = 4,
) {
  return TableService.createTable(user.organizationId, branch.id, { tableNumber, capacity }, user.id);
}

function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

describe('ReservationService', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('books a reservation and excludes the table from availability for the same window', async () => {
    const { user, branch } = await setupOrgWithBranch('a');
    const table = await createTable(user, branch);
    const startAt = hoursFromNow(24);

    const reservation = await ReservationService.createReservation(
      user.organizationId,
      branch.id,
      { tableIds: [table.id], startAt, durationMinutes: 90, guestCount: 2, guestName: 'Guest A', depositRequired: false },
      user.id,
    );
    expect(reservation.status).toBe('PENDING');
    expect(reservation.tables).toHaveLength(1);
    const firstReservationTable = reservation.tables[0];
    if (!firstReservationTable) throw new Error('Expected one reservation table');
    expect(firstReservationTable.table.id).toBe(table.id);

    const available = await ReservationService.findAvailableTables(user.organizationId, branch.id, {
      startAt,
      durationMinutes: 90,
      guestCount: 2,
    });
    expect(available.find((t) => t.id === table.id)).toBeUndefined();
  });

  it('finds an available table for a non-overlapping window on the same table', async () => {
    const { user, branch } = await setupOrgWithBranch('a2');
    const table = await createTable(user, branch);
    await ReservationService.createReservation(
      user.organizationId,
      branch.id,
      { tableIds: [table.id], startAt: hoursFromNow(24), durationMinutes: 60, guestCount: 2, guestName: 'Guest A2', depositRequired: false },
      user.id,
    );

    // 3 hours later — no overlap with the 1-hour booking above.
    const available = await ReservationService.findAvailableTables(user.organizationId, branch.id, {
      startAt: hoursFromNow(27),
      durationMinutes: 60,
      guestCount: 2,
    });
    expect(available.find((t) => t.id === table.id)).toBeDefined();
  });

  it('rejects booking more guests than the assigned tables can seat', async () => {
    const { user, branch } = await setupOrgWithBranch('b');
    const table = await createTable(user, branch, 'T1', 2);
    await expect(
      ReservationService.createReservation(
        user.organizationId,
        branch.id,
        { tableIds: [table.id], startAt: hoursFromNow(24), durationMinutes: 90, guestCount: 6, guestName: 'Guest B', depositRequired: false },
        user.id,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects an illegal status transition (PENDING -> SEATED)', async () => {
    const { user, branch } = await setupOrgWithBranch('c');
    const table = await createTable(user, branch);
    const reservation = await ReservationService.createReservation(
      user.organizationId,
      branch.id,
      { tableIds: [table.id], startAt: hoursFromNow(24), durationMinutes: 90, guestCount: 2, guestName: 'Guest C', depositRequired: false },
      user.id,
    );
    await expect(
      ReservationService.updateStatus(user.organizationId, branch.id, reservation.id, { status: 'SEATED' }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('walks a reservation through its full legal lifecycle', async () => {
    const { user, branch } = await setupOrgWithBranch('c2');
    const table = await createTable(user, branch);
    const reservation = await ReservationService.createReservation(
      user.organizationId,
      branch.id,
      { tableIds: [table.id], startAt: hoursFromNow(24), durationMinutes: 90, guestCount: 2, guestName: 'Guest C2', depositRequired: false },
      user.id,
    );

    const confirmed = await ReservationService.updateStatus(
      user.organizationId, branch.id, reservation.id, { status: 'CONFIRMED' }, user.id,
    );
    expect(confirmed.status).toBe('CONFIRMED');

    const seated = await ReservationService.updateStatus(
      user.organizationId, branch.id, reservation.id, { status: 'SEATED' }, user.id,
    );
    expect(seated.status).toBe('SEATED');

    const completed = await ReservationService.updateStatus(
      user.organizationId, branch.id, reservation.id, { status: 'COMPLETED' }, user.id,
    );
    expect(completed.status).toBe('COMPLETED');

    const history = await ReservationService.getStatusHistory(user.organizationId, branch.id, reservation.id);
    expect(history.map((h) => h.toStatus)).toEqual(['COMPLETED', 'SEATED', 'CONFIRMED', 'PENDING']);
  });

  it('requires a cancellation reason to cancel', async () => {
    const { user, branch } = await setupOrgWithBranch('c3');
    const table = await createTable(user, branch);
    const reservation = await ReservationService.createReservation(
      user.organizationId,
      branch.id,
      { tableIds: [table.id], startAt: hoursFromNow(24), durationMinutes: 90, guestCount: 2, guestName: 'Guest C3', depositRequired: false },
      user.id,
    );
    await expect(
      ReservationService.updateStatus(user.organizationId, branch.id, reservation.id, { status: 'CANCELLED' }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('cancelling a reservation frees the table for the same window', async () => {
    const { user, branch } = await setupOrgWithBranch('d');
    const table = await createTable(user, branch);
    const startAt = hoursFromNow(24);
    const reservation = await ReservationService.createReservation(
      user.organizationId,
      branch.id,
      { tableIds: [table.id], startAt, durationMinutes: 90, guestCount: 2, guestName: 'Guest D', depositRequired: false },
      user.id,
    );

    await ReservationService.updateStatus(
      user.organizationId,
      branch.id,
      reservation.id,
      { status: 'CANCELLED', cancellationReason: 'Change of plans' },
      user.id,
    );

    // Rebooking the exact same table/window must now succeed — the
    // cancelled row's denormalized status was updated in the same
    // transaction, so the DB EXCLUDE constraint's WHERE clause excludes it.
    const rebooked = await ReservationService.createReservation(
      user.organizationId,
      branch.id,
      { tableIds: [table.id], startAt, durationMinutes: 90, guestCount: 2, guestName: 'Guest D2', depositRequired: false },
      user.id,
    );
    expect(rebooked.status).toBe('PENDING');
  });

  it('does not expose a reservation from another organization', async () => {
    const orgA = await setupOrgWithBranch('e');
    const orgB = await setupOrgWithBranch('f');
    const table = await createTable(orgA.user, orgA.branch);
    const reservation = await ReservationService.createReservation(
      orgA.user.organizationId,
      orgA.branch.id,
      { tableIds: [table.id], startAt: hoursFromNow(24), durationMinutes: 90, guestCount: 2, guestName: 'Guest E', depositRequired: false },
      orgA.user.id,
    );

    await expect(
      ReservationService.get(orgB.user.organizationId, orgB.branch.id, reservation.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('records a manual deposit payment', async () => {
    const { user, branch } = await setupOrgWithBranch('g');
    const table = await createTable(user, branch);
    const reservation = await ReservationService.createReservation(
      user.organizationId,
      branch.id,
      { tableIds: [table.id], startAt: hoursFromNow(24), durationMinutes: 90, guestCount: 2, guestName: 'Guest G', depositRequired: false },
      user.id,
    );

    const updated = await ReservationService.recordDeposit(
      user.organizationId,
      branch.id,
      reservation.id,
      { depositStatus: 'PAID', depositAmount: '750.00', depositNote: 'Cash at booking' },
      user.id,
    );
    expect(updated.depositStatus).toBe('PAID');
    expect(updated.depositAmount?.toFixed(2)).toBe('750.00');
  });

  /**
   * The real proof of the DB-enforced double-booking guarantee: two
   * genuinely concurrent createReservation calls targeting the same table
   * and an overlapping time window, fired together with Promise.allSettled
   * rather than sequentially. This only passes if Postgres' `no_double_booking`
   * EXCLUDE constraint — not just an application-level check with a race
   * window — is what actually rejects the loser. See also the raw
   * two-psql-session proof recorded in docs/database.md / CLAUDE.md.
   */
  it('prevents a genuine concurrent double-booking of the same table', async () => {
    const { user, branch } = await setupOrgWithBranch('h');
    const table = await createTable(user, branch, 'T1', 8);
    const startAt = hoursFromNow(48);

    const attempt = (guestName: string) =>
      ReservationService.createReservation(
        user.organizationId,
        branch.id,
        { tableIds: [table.id], startAt, durationMinutes: 90, guestCount: 2, guestName, depositRequired: false },
        user.id,
      );

    const results = await Promise.allSettled([attempt('Concurrent Guest 1'), attempt('Concurrent Guest 2')]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    const bookedCount = await prisma.reservationTable.count({ where: { tableId: table.id } });
    expect(bookedCount).toBe(1);
  });
});
