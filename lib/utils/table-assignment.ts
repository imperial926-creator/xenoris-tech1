/**
 * CAPP Phase 3 — pure table auto-assignment logic for customer-facing
 * reservations, extracted out of `CustomerReservationService` (same reason
 * `business-hours.ts` was extracted in Phase 2: this build environment has
 * no `node_modules`/DB, so anything worth unit-testing without a live
 * Postgres connection has to be pure functions taking plain data in and
 * returning plain data out — see tests/unit/utils/table-assignment.test.ts).
 *
 * `AssignableTable` is intentionally a minimal shape (not the full Prisma
 * `RestaurantTable` type) so this module has zero dependency on `@prisma/client`
 * and stays trivially testable with hand-built fixtures.
 */

export interface AssignableTable {
  id: string;
  capacity: number;
  section: { name: string } | null;
}

export interface TableAssignment {
  tableIds: string[];
  /**
   * Whether the diner's seating preference was actually satisfied. `false`
   * means the pool matching the preference couldn't seat the party and the
   * assignment silently widened to any available table — the caller is
   * expected to report this honestly rather than pretend the preference
   * was honored (spec's dev principles: "Do not fake reservation
   * availability").
   */
  preferenceHonored: boolean;
}

/**
 * Auto-assigns the smallest sufficient table, or — if no single table is
 * big enough — the smallest greedy combination of tables, that can seat
 * `guestCount`. `tables` is assumed already filtered to the correct
 * branch/time-window/active-table set and free of double-bookings (that
 * filtering is `ReservationService.findAvailableTables`'s job, not this
 * function's) and sorted ascending by capacity, matching that method's
 * `orderBy: [{ capacity: 'asc' }, ...]`.
 *
 * `seatingPreference` is a SOFT filter (spec § 10: "preferred seating where
 * available"): tried first against tables whose section name contains it
 * (case-insensitive), only widened to the full table list if that subset
 * cannot seat the party at all. Returns `null` if the party cannot be
 * seated even using every available table.
 */
export function selectTables(
  tables: AssignableTable[],
  guestCount: number,
  seatingPreference: string | undefined,
): TableAssignment | null {
  if (seatingPreference) {
    const needle = seatingPreference.trim().toLowerCase();
    const preferred = tables.filter((t) => t.section?.name.toLowerCase().includes(needle));
    const viaPreferred = fitParty(preferred, guestCount);
    if (viaPreferred) return { tableIds: viaPreferred, preferenceHonored: true };
  }
  const viaAny = fitParty(tables, guestCount);
  return viaAny ? { tableIds: viaAny, preferenceHonored: false } : null;
}

/** Whether `guestCount` can be seated at all by some subset of `tables` (single table or a combination). */
export function canSeatParty(tables: AssignableTable[], guestCount: number): boolean {
  return selectTables(tables, guestCount, undefined) !== null;
}

function fitParty(pool: AssignableTable[], guestCount: number): string[] | null {
  const single = pool.find((t) => t.capacity >= guestCount);
  if (single) return [single.id];

  const combo: AssignableTable[] = [];
  let capacity = 0;
  for (const table of pool) {
    combo.push(table);
    capacity += table.capacity;
    if (capacity >= guestCount) return combo.map((t) => t.id);
  }
  return null;
}
