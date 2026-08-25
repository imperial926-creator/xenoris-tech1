import { describe, it, expect } from 'vitest';
import { startOfDayInTimezone, endOfDayInTimezone, resolveDateRangePreset } from '@/lib/utils/timezone';

const TZ = 'Asia/Manila'; // UTC+8, no DST — every boundary below is exact, not an approximation.

// 2026-08-17T03:30:00Z = 2026-08-17 11:30 Manila, a Monday.
const NOW = new Date('2026-08-17T03:30:00.000Z');

describe('startOfDayInTimezone / endOfDayInTimezone', () => {
  it('returns the UTC instant for local midnight and local 23:59:59.999', () => {
    expect(startOfDayInTimezone(NOW, TZ).toISOString()).toBe('2026-08-16T16:00:00.000Z');
    expect(endOfDayInTimezone(NOW, TZ).toISOString()).toBe('2026-08-17T15:59:59.999Z');
  });
});

describe('resolveDateRangePreset', () => {
  it('today / yesterday', () => {
    const today = resolveDateRangePreset('today', TZ, NOW);
    expect(today.startDate.toISOString()).toBe('2026-08-16T16:00:00.000Z');
    expect(today.endDate.toISOString()).toBe('2026-08-17T15:59:59.999Z');

    const yesterday = resolveDateRangePreset('yesterday', TZ, NOW);
    expect(yesterday.startDate.toISOString()).toBe('2026-08-15T16:00:00.000Z');
    expect(yesterday.endDate.toISOString()).toBe('2026-08-16T15:59:59.999Z');
  });

  it('this_week / last_week start on Monday', () => {
    const thisWeek = resolveDateRangePreset('this_week', TZ, NOW);
    // NOW is itself a Monday, so this_week should start today.
    expect(thisWeek.startDate.toISOString()).toBe('2026-08-16T16:00:00.000Z');
    expect(thisWeek.endDate.toISOString()).toBe('2026-08-23T15:59:59.999Z'); // Sunday

    const lastWeek = resolveDateRangePreset('last_week', TZ, NOW);
    expect(lastWeek.startDate.toISOString()).toBe('2026-08-09T16:00:00.000Z');
    expect(lastWeek.endDate.toISOString()).toBe('2026-08-16T15:59:59.999Z');
  });

  it('this_month / last_month span calendar month boundaries', () => {
    const thisMonth = resolveDateRangePreset('this_month', TZ, NOW);
    expect(thisMonth.startDate.toISOString()).toBe('2026-07-31T16:00:00.000Z'); // Aug 1 00:00 Manila
    expect(thisMonth.endDate.toISOString()).toBe('2026-08-31T15:59:59.999Z'); // Aug 31 23:59:59.999 Manila

    const lastMonth = resolveDateRangePreset('last_month', TZ, NOW);
    expect(lastMonth.startDate.toISOString()).toBe('2026-06-30T16:00:00.000Z'); // Jul 1
    expect(lastMonth.endDate.toISOString()).toBe('2026-07-31T15:59:59.999Z'); // Jul 31
  });

  it('this_quarter spans the calendar quarter containing NOW', () => {
    const q = resolveDateRangePreset('this_quarter', TZ, NOW);
    expect(q.startDate.toISOString()).toBe('2026-06-30T16:00:00.000Z'); // Jul 1 (Q3: Jul-Sep)
    expect(q.endDate.toISOString()).toBe('2026-09-30T15:59:59.999Z'); // Sep 30
  });

  it('this_year spans the calendar year', () => {
    const y = resolveDateRangePreset('this_year', TZ, NOW);
    expect(y.startDate.toISOString()).toBe('2025-12-31T16:00:00.000Z'); // Jan 1, 2026
    expect(y.endDate.toISOString()).toBe('2026-12-31T15:59:59.999Z'); // Dec 31, 2026
  });

  it('custom uses the given start/end, snapped to local whole days', () => {
    const custom = resolveDateRangePreset('custom', TZ, NOW, new Date('2026-01-05T00:00:00.000Z'), new Date('2026-01-10T00:00:00.000Z'));
    expect(custom.startDate.toISOString()).toBe('2026-01-04T16:00:00.000Z'); // Jan 5 00:00 Manila
    expect(custom.endDate.toISOString()).toBe('2026-01-10T15:59:59.999Z'); // Jan 10 23:59:59.999 Manila
  });

  it('custom throws without both bounds', () => {
    expect(() => resolveDateRangePreset('custom', TZ, NOW)).toThrow();
    expect(() => resolveDateRangePreset('custom', TZ, NOW, new Date())).toThrow();
  });
});
