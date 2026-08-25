/**
 * Shared Branch.openingHours parsing/evaluation helpers. Extracted from
 * `services/reservations/ReservationService.ts`'s private
 * `dayKeyInTimezone`/`minutesSinceMidnightInTimezone`/`parseHHMM` methods
 * (added Phase 3, used there to validate a *requested* booking time falls
 * within business hours) so CAPP Phase 2 can reuse the exact same
 * day-key/minutes-since-midnight logic for a different question — "is the
 * branch open right *now*" (master spec § 8's Restaurant Home Screen
 * OPEN/CLOSED indicator) — instead of quietly re-implementing it. See
 * `isBranchOpenNow` below for the "now" version; `ReservationService` still
 * owns the "is this requested time within hours" check, now built on the
 * same primitives exported here.
 *
 * Built on `Intl.DateTimeFormat` against an IANA timezone string, not a
 * date library — same reason as `lib/utils/timezone.ts`: date-fns-tz is
 * declared in package.json but this build environment cannot run
 * `npm install`, so anything on the request path avoids depending on code
 * that has never actually been resolved (see CLAUDE.md → Known Issues).
 */

import type { BranchStatus } from '@prisma/client';

export type WeeklyOpeningHours = Record<string, { open: string; close: string; closed?: boolean }>;

/** Monday..Sunday short day key ("mon".."sun") for `date` as observed in `timezone`. */
export function dayKeyInTimezone(date: Date, timezone: string): string {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
    .format(date)
    .toLowerCase();
  // Intl gives "mon", "tue", ... "sun" for en-US 'short' — matches
  // openingHoursSchema's (lib/validation/branch.ts) day keys exactly.
  return weekday;
}

/** Minutes since local midnight for `date` as observed in `timezone` (0–1439). */
export function minutesSinceMidnightInTimezone(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  // Intl can render midnight as "24:00" for hour12: false — normalize.
  return (hour % 24) * 60 + minute;
}

/** Parses an "HH:MM" string into minutes-since-midnight, or null if malformed. */
export function parseHHMM(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Whether a branch is open right now, from its administrative `status` plus
 * `openingHours` JSON. Used by the customer app's Restaurant Home Screen
 * (spec § 8) — read-only, unlike `ReservationService.assertWithinBusinessHours`
 * which throws to block an out-of-hours booking.
 *
 * `INACTIVE`/`TEMPORARILY_CLOSED` always reports closed, regardless of
 * today's configured hours. `ACTIVE` with no `openingHours` configured *at
 * all*, or none for today specifically, reports **open** rather than
 * guessing closed — same "missing configuration doesn't block the
 * restaurant" stance `assertWithinBusinessHours` takes (it skips its check
 * rather than rejecting), just inverted for a status read instead of a
 * validation gate. An explicit `{ closed: true }` entry for today always
 * wins over that default, though.
 *
 * Unlike `assertWithinBusinessHours` (which only validates a single
 * same-day requested window and explicitly flags-and-skips anything that
 * crosses midnight — see its comment), a live "is it open right now" check
 * has no request window it can decline to answer for. So this also checks
 * *yesterday's* entry: if yesterday's hours cross midnight (`close` <
 * `open`, e.g. open 18:00/close 02:00) and "now" is still before that close
 * time, the branch is open on yesterday's overnight window even though
 * today's own entry (if any) hasn't started yet.
 */
export function isBranchOpenNow(
  branch: { status: BranchStatus; openingHours: unknown; timezone: string },
  now: Date,
): boolean {
  if (branch.status !== 'ACTIVE') return false;

  const hours = branch.openingHours as WeeklyOpeningHours | null;
  if (!hours) return true;

  const nowMinutes = minutesSinceMidnightInTimezone(now, branch.timezone);
  const today = hours[dayKeyInTimezone(now, branch.timezone)];

  if (isOpenUnderTodaysEntry(today, nowMinutes)) return true;

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdaysEntry = hours[dayKeyInTimezone(yesterday, branch.timezone)];
  if (isOpenUnderOvernightSpillover(yesterdaysEntry, nowMinutes)) return true;

  // No entry for today at all (not even `{ closed: true }`) — missing
  // configuration for this specific day doesn't imply closed.
  return !today;
}

function isOpenUnderTodaysEntry(
  day: WeeklyOpeningHours[string] | undefined,
  nowMinutes: number,
): boolean {
  if (!day || day.closed) return false;
  const openMinutes = parseHHMM(day.open);
  const closeMinutes = parseHHMM(day.close);
  if (openMinutes === null || closeMinutes === null) return false;
  if (closeMinutes > openMinutes) {
    return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
  }
  // Crosses midnight — the "before closing" half of this window belongs to
  // *tomorrow* and is handled by isOpenUnderOvernightSpillover when
  // tomorrow evaluates itself; today only needs "now" at/after opening.
  return nowMinutes >= openMinutes;
}

function isOpenUnderOvernightSpillover(
  yesterdaysEntry: WeeklyOpeningHours[string] | undefined,
  nowMinutes: number,
): boolean {
  if (!yesterdaysEntry || yesterdaysEntry.closed) return false;
  const openMinutes = parseHHMM(yesterdaysEntry.open);
  const closeMinutes = parseHHMM(yesterdaysEntry.close);
  if (openMinutes === null || closeMinutes === null) return false;
  if (closeMinutes > openMinutes) return false; // Not an overnight window.
  return nowMinutes < closeMinutes;
}
