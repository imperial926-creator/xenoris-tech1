/**
 * Timezone-aware date-range helpers, used by the Phase 11 financial reports
 * (Income Statement / Cash Flow date ranges, the dashboard's "Today") and
 * their report-filter presets (master spec §54: Today, Yesterday, This
 * week, Last week, This month, Last month, This quarter, This year, Custom
 * date range), plus Phase 12's analytics trend bucketing (day/week/month
 * buckets for the Revenue/Profit dashboards).
 *
 * Built on `Intl.DateTimeFormat` against an IANA timezone string, not a
 * date library — same reason as ReservationService's dayKeyInTimezone/
 * minutesSinceMidnightInTimezone: date-fns-tz is declared in package.json
 * but this build environment cannot run `npm install`, so anything on the
 * request path avoids depending on code that has never actually been
 * resolved (see CLAUDE.md → Known Issues). Every branch/organization in
 * this build defaults its timezone to 'Asia/Manila' (no DST, so every
 * "add exactly 24h" step below is exact for the default case, and a
 * reasonable practical approximation for any other IANA zone that does
 * observe DST).
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

/**
 * The UTC instant for 00:00:00.000 local time on an explicit local
 * calendar date (year/month/day, not derived from formatting an
 * intermediate proxy `Date`). This is the one primitive every "start of
 * day/week/month/quarter/year" helper below is built from — constructing a
 * calendar date directly here (rather than building a `Date.UTC(...)`
 * proxy for some *other* day and then re-formatting it through the zone to
 * "discover" its local date) matters for timezones west of UTC: a naive
 * `new Date(Date.UTC(year, month - 1, 1))` proxy for "the 1st of the
 * month" can format to the *last day of the previous month* once
 * re-interpreted in a west-of-UTC zone, silently corrupting month/quarter/
 * year boundaries. Every caller below supplies year/month/day it already
 * knows are correct (from `getDatePartsInTimezone` on a real instant, or
 * from its own calendar arithmetic), so that failure mode can't occur here.
 */
function startOfLocalDateInTimezone(year: number, month: number, day: number, timezone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const offsetMinutes = getTimezoneOffsetMinutes(guess, timezone);
  return new Date(guess.getTime() - offsetMinutes * 60000);
}

/** The UTC instant corresponding to 00:00:00.000 local time, in `timezone`, on the calendar date `date` falls on in that zone. */
export function startOfDayInTimezone(date: Date, timezone: string): Date {
  const p = getDatePartsInTimezone(date, timezone);
  return startOfLocalDateInTimezone(p.year, p.month, p.day, timezone);
}

/** The UTC instant corresponding to 23:59:59.999 local time, in `timezone`, on the calendar date `date` falls on in that zone. */
export function endOfDayInTimezone(date: Date, timezone: string): Date {
  return new Date(startOfDayInTimezone(date, timezone).getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Monday-start day-of-week index (0 = Monday .. 6 = Sunday) for `date` as observed in `timezone`. */
function isoWeekdayInTimezone(date: Date, timezone: string): number {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const idx = order.indexOf(weekday);
  return idx === -1 ? 0 : idx;
}

/** Start of the Monday-based week (00:00 local) containing `date`. */
export function startOfWeekInTimezone(date: Date, timezone: string): Date {
  const weekday = isoWeekdayInTimezone(date, timezone);
  const todayStart = startOfDayInTimezone(date, timezone);
  return new Date(todayStart.getTime() - weekday * 24 * 60 * 60 * 1000);
}

/** End of the Monday-based week (23:59:59.999 local) containing `date`. */
export function endOfWeekInTimezone(date: Date, timezone: string): Date {
  return new Date(startOfWeekInTimezone(date, timezone).getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
}

/** Start of the calendar month (00:00 local, day 1) containing `date`. */
export function startOfMonthInTimezone(date: Date, timezone: string): Date {
  const p = getDatePartsInTimezone(date, timezone);
  return startOfLocalDateInTimezone(p.year, p.month, 1, timezone);
}

function startOfNextMonthInTimezone(date: Date, timezone: string): Date {
  const p = getDatePartsInTimezone(date, timezone);
  return p.month === 12
    ? startOfLocalDateInTimezone(p.year + 1, 1, 1, timezone)
    : startOfLocalDateInTimezone(p.year, p.month + 1, 1, timezone);
}

/** End of the calendar month (23:59:59.999 local, last day) containing `date`. */
export function endOfMonthInTimezone(date: Date, timezone: string): Date {
  return new Date(startOfNextMonthInTimezone(date, timezone).getTime() - 1);
}

/** Start of the calendar quarter (Jan/Apr/Jul/Oct 1, 00:00 local) containing `date`. */
export function startOfQuarterInTimezone(date: Date, timezone: string): Date {
  const p = getDatePartsInTimezone(date, timezone);
  const quarterStartMonth = Math.floor((p.month - 1) / 3) * 3 + 1; // 1-indexed
  return startOfLocalDateInTimezone(p.year, quarterStartMonth, 1, timezone);
}

function startOfNextQuarterInTimezone(date: Date, timezone: string): Date {
  const p = getDatePartsInTimezone(date, timezone);
  const quarterStartMonth = Math.floor((p.month - 1) / 3) * 3 + 1;
  const nextQuarterStartMonth = quarterStartMonth + 3;
  return nextQuarterStartMonth > 12
    ? startOfLocalDateInTimezone(p.year + 1, nextQuarterStartMonth - 12, 1, timezone)
    : startOfLocalDateInTimezone(p.year, nextQuarterStartMonth, 1, timezone);
}

/** End of the calendar quarter (23:59:59.999 local, last day) containing `date`. */
export function endOfQuarterInTimezone(date: Date, timezone: string): Date {
  return new Date(startOfNextQuarterInTimezone(date, timezone).getTime() - 1);
}

/** Start of the calendar year (Jan 1, 00:00 local) containing `date`. */
export function startOfYearInTimezone(date: Date, timezone: string): Date {
  const p = getDatePartsInTimezone(date, timezone);
  return startOfLocalDateInTimezone(p.year, 1, 1, timezone);
}

/** End of the calendar year (23:59:59.999 local, Dec 31) containing `date`. */
export function endOfYearInTimezone(date: Date, timezone: string): Date {
  const p = getDatePartsInTimezone(date, timezone);
  return new Date(startOfLocalDateInTimezone(p.year + 1, 1, 1, timezone).getTime() - 1);
}

/**
 * "YYYY-MM-DD" grouping key for `date`'s local calendar day in `timezone`
 * — used by Phase 12's analytics trend bucketing (AnalyticsService) to
 * group raw rows into day buckets without a second round of Date algebra
 * per row.
 */
export function dateKeyInTimezone(date: Date, timezone: string): string {
  const p = getDatePartsInTimezone(date, timezone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
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
      const y = new Date(startOfDayInTimezone(now, timezone).getTime() - 24 * 60 * 60 * 1000);
      return { startDate: startOfDayInTimezone(y, timezone), endDate: endOfDayInTimezone(y, timezone) };
    }
    case 'this_week': {
      return { startDate: startOfWeekInTimezone(now, timezone), endDate: endOfWeekInTimezone(now, timezone) };
    }
    case 'last_week': {
      const lastWeekAnchor = new Date(startOfWeekInTimezone(now, timezone).getTime() - 24 * 60 * 60 * 1000);
      return { startDate: startOfWeekInTimezone(lastWeekAnchor, timezone), endDate: endOfWeekInTimezone(lastWeekAnchor, timezone) };
    }
    case 'this_month': {
      return { startDate: startOfMonthInTimezone(now, timezone), endDate: endOfMonthInTimezone(now, timezone) };
    }
    case 'last_month': {
      const lastMonthAnchor = new Date(startOfMonthInTimezone(now, timezone).getTime() - 24 * 60 * 60 * 1000);
      return { startDate: startOfMonthInTimezone(lastMonthAnchor, timezone), endDate: endOfMonthInTimezone(lastMonthAnchor, timezone) };
    }
    case 'this_quarter': {
      return { startDate: startOfQuarterInTimezone(now, timezone), endDate: endOfQuarterInTimezone(now, timezone) };
    }
    case 'this_year': {
      return { startDate: startOfYearInTimezone(now, timezone), endDate: endOfYearInTimezone(now, timezone) };
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
