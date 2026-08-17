/**
 * Timezone-aware date-range helpers, used by the Phase 11 financial reports
 * (Income Statement / Cash Flow date ranges, the dashboard's "Today") and
 * their report-filter presets (master spec §54: Today, Yesterday, This
 * week, Last week, This month, Last month, This quarter, This year, Custom
 * date range).
 *
 * Built on `Intl.DateTimeFormat` against an IANA timezone string, not a
 * date library — same reason as ReservationService's dayKeyInTimezone/
 * minutesSinceMidnightInTimezone: date-fns-tz is declared in package.json
 * but this build environment cannot run `npm install`, so anything on the
 * request path avoids depending on code that has never actually been
 * resolved (see CLAUDE.md → Known Issues). Every branch/organization in
 * this build defaults its timezone to 'Asia/Manila' (no DST, so the single-
 * iteration offset calculation below is exact for the default case, and a
 * reasonable practical approximation for any other IANA zone).
 */

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function getDatePartsInTimezone(date: Date, timezone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Intl can render midnight as "24:00" for hour12: false — normalize.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * The IANA zone's UTC offset (in minutes, positive east of UTC) at the
 * given instant — derived by formatting that instant in the zone and
 * comparing the result (interpreted as if it were UTC) back against the
 * original instant.
 */
function getTimezoneOffsetMinutes(instant: Date, timezone: string): number {
  const p = getDatePartsInTimezone(instant, timezone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUTC - instant.getTime()) / 60000;
}

/** The UTC instant corresponding to 00:00:00.000 local time, in `timezone`, on the calendar date `date` falls on in that zone. */
export function startOfDayInTimezone(date: Date, timezone: string): Date {
  const p = getDatePartsInTimezone(date, timezone);
  const guess = new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0, 0));
  const offsetMinutes = getTimezoneOffsetMinutes(guess, timezone);
  return new Date(guess.getTime() - offsetMinutes * 60000);
}

/** The UTC instant corresponding to 23:59:59.999 local time, in `timezone`, on the calendar date `date` falls on in that zone. */
export function endOfDayInTimezone(date: Date, timezone: string): Date {
  const nextDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const nextDayStart = startOfDayInTimezone(nextDay, timezone);
  return new Date(nextDayStart.getTime() - 1);
}

function addDaysUTC(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Monday-start day-of-week index (0 = Monday .. 6 = Sunday) for `date` as observed in `timezone`. */
function isoWeekdayInTimezone(date: Date, timezone: string): number {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const idx = order.indexOf(weekday);
  return idx === -1 ? 0 : idx;
}

export const DATE_RANGE_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'this_year',
  'custom',
] as const;
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

export type DateRange = { startDate: Date; endDate: Date };

/**
 * Resolves a master-spec-§54 report-filter preset into a concrete
 * [startDate, endDate] instant pair, evaluated against `now` in
 * `timezone`. `custom` requires both `customStart`/`customEnd` (validated
 * upstream by lib/validation/reporting.ts) and is interpreted as the full
 * local day from customStart's start-of-day through customEnd's end-of-day
 * (an inclusive whole-day range, matching every other preset here).
 */
export function resolveDateRangePreset(
  preset: DateRangePreset,
  timezone: string,
  now: Date,
  customStart?: Date,
  customEnd?: Date,
): DateRange {
  switch (preset) {
    case 'today': {
      return { startDate: startOfDayInTimezone(now, timezone), endDate: endOfDayInTimezone(now, timezone) };
    }
    case 'yesterday': {
      const y = addDaysUTC(now, -1);
      return { startDate: startOfDayInTimezone(y, timezone), endDate: endOfDayInTimezone(y, timezone) };
    }
    case 'this_week': {
      const weekday = isoWeekdayInTimezone(now, timezone); // 0 = Monday
      const monday = addDaysUTC(now, -weekday);
      const sunday = addDaysUTC(monday, 6);
      return { startDate: startOfDayInTimezone(monday, timezone), endDate: endOfDayInTimezone(sunday, timezone) };
    }
    case 'last_week': {
      const weekday = isoWeekdayInTimezone(now, timezone);
      const thisMonday = addDaysUTC(now, -weekday);
      const lastMonday = addDaysUTC(thisMonday, -7);
      const lastSunday = addDaysUTC(lastMonday, 6);
      return { startDate: startOfDayInTimezone(lastMonday, timezone), endDate: endOfDayInTimezone(lastSunday, timezone) };
    }
    case 'this_month': {
      const p = getDatePartsInTimezone(now, timezone);
      const monthStart = new Date(Date.UTC(p.year, p.month - 1, 1));
      const monthEndExclusive = new Date(Date.UTC(p.year, p.month, 1));
      const lastDayOfMonth = addDaysUTC(monthEndExclusive, -1);
      return { startDate: startOfDayInTimezone(monthStart, timezone), endDate: endOfDayInTimezone(lastDayOfMonth, timezone) };
    }
    case 'last_month': {
      const p = getDatePartsInTimezone(now, timezone);
      const prevMonthStart = new Date(Date.UTC(p.year, p.month - 2, 1));
      const thisMonthStart = new Date(Date.UTC(p.year, p.month - 1, 1));
      const lastDayOfPrevMonth = addDaysUTC(thisMonthStart, -1);
      return { startDate: startOfDayInTimezone(prevMonthStart, timezone), endDate: endOfDayInTimezone(lastDayOfPrevMonth, timezone) };
    }
    case 'this_quarter': {
      const p = getDatePartsInTimezone(now, timezone);
      const quarterStartMonth = Math.floor((p.month - 1) / 3) * 3; // 0-indexed
      const quarterStart = new Date(Date.UTC(p.year, quarterStartMonth, 1));
      const quarterEndExclusive = new Date(Date.UTC(p.year, quarterStartMonth + 3, 1));
      const lastDayOfQuarter = addDaysUTC(quarterEndExclusive, -1);
      return { startDate: startOfDayInTimezone(quarterStart, timezone), endDate: endOfDayInTimezone(lastDayOfQuarter, timezone) };
    }
    case 'this_year': {
      const p = getDatePartsInTimezone(now, timezone);
      const yearStart = new Date(Date.UTC(p.year, 0, 1));
      const yearEnd = new Date(Date.UTC(p.year, 11, 31));
      return { startDate: startOfDayInTimezone(yearStart, timezone), endDate: endOfDayInTimezone(yearEnd, timezone) };
    }
    case 'custom': {
      if (!customStart || !customEnd) {
        throw new Error('resolveDateRangePreset: "custom" requires both customStart and customEnd.');
      }
      return { startDate: startOfDayInTimezone(customStart, timezone), endDate: endOfDayInTimezone(customEnd, timezone) };
    }
    default: {
      // Exhaustiveness guard — TypeScript would already flag an unhandled
      // preset above, this is the runtime backstop for any value that
      // slips past validation (e.g. through the sandbox's TS2307-degraded
      // type checking on this file's own imports elsewhere).
      const _exhaustive: never = preset;
      throw new Error(`resolveDateRangePreset: unknown preset "${_exhaustive as string}".`);
    }
  }
}
