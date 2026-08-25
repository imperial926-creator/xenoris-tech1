import { describe, it, expect } from 'vitest';
import { isBranchOpenNow, dayKeyInTimezone, minutesSinceMidnightInTimezone, parseHHMM } from '@/lib/utils/business-hours';

const TZ = 'Asia/Manila'; // UTC+8, no DST.

// 2026-08-17T03:30:00Z = 2026-08-17 11:30 Manila, a Monday.
const MONDAY_1130 = new Date('2026-08-17T03:30:00.000Z');

function branch(overrides: Partial<{ status: 'ACTIVE' | 'INACTIVE' | 'TEMPORARILY_CLOSED'; openingHours: unknown; timezone: string }> = {}) {
  return {
    status: 'ACTIVE' as const,
    openingHours: null,
    timezone: TZ,
    ...overrides,
  };
}

describe('dayKeyInTimezone / minutesSinceMidnightInTimezone / parseHHMM', () => {
  it('resolves the correct day key and minutes-since-midnight', () => {
    expect(dayKeyInTimezone(MONDAY_1130, TZ)).toBe('mon');
    expect(minutesSinceMidnightInTimezone(MONDAY_1130, TZ)).toBe(11 * 60 + 30);
  });

  it('parses HH:MM and rejects malformed input', () => {
    expect(parseHHMM('09:00')).toBe(9 * 60);
    expect(parseHHMM('22:30')).toBe(22 * 60 + 30);
    expect(parseHHMM('not-a-time')).toBeNull();
  });
});

describe('isBranchOpenNow', () => {
  it('reports open when no openingHours are configured at all', () => {
    expect(isBranchOpenNow(branch({ openingHours: null }), MONDAY_1130)).toBe(true);
  });

  it('reports open when today has no entry in openingHours', () => {
    const hours = { tue: { open: '09:00', close: '22:00' } };
    expect(isBranchOpenNow(branch({ openingHours: hours }), MONDAY_1130)).toBe(true);
  });

  it('reports open when now falls within today\'s configured window', () => {
    const hours = { mon: { open: '09:00', close: '22:00' } };
    expect(isBranchOpenNow(branch({ openingHours: hours }), MONDAY_1130)).toBe(true);
  });

  it('reports closed when now falls outside today\'s configured window', () => {
    const hours = { mon: { open: '13:00', close: '22:00' } };
    expect(isBranchOpenNow(branch({ openingHours: hours }), MONDAY_1130)).toBe(false);
  });

  it('reports closed when today is explicitly marked closed', () => {
    const hours = { mon: { open: '09:00', close: '22:00', closed: true } };
    expect(isBranchOpenNow(branch({ openingHours: hours }), MONDAY_1130)).toBe(false);
  });

  it('reports closed regardless of hours when status is TEMPORARILY_CLOSED', () => {
    const hours = { mon: { open: '00:00', close: '23:59' } };
    expect(
      isBranchOpenNow(branch({ openingHours: hours, status: 'TEMPORARILY_CLOSED' }), MONDAY_1130),
    ).toBe(false);
  });

  it('reports closed regardless of hours when status is INACTIVE', () => {
    const hours = { mon: { open: '00:00', close: '23:59' } };
    expect(isBranchOpenNow(branch({ openingHours: hours, status: 'INACTIVE' }), MONDAY_1130)).toBe(
      false,
    );
  });

  it('handles an overnight window: open after today\'s opening time', () => {
    // 2026-08-17T12:00:00Z = 20:00 Manila, same Monday.
    const openLate = new Date('2026-08-17T12:00:00.000Z');
    const hours = { mon: { open: '18:00', close: '02:00' } };
    expect(isBranchOpenNow(branch({ openingHours: hours }), openLate)).toBe(true);
  });

  it('handles an overnight window: still open the next calendar day before closing', () => {
    // 2026-08-17T17:00:00Z = 2026-08-18 01:00 Manila — Tuesday, 1am.
    const afterMidnight = new Date('2026-08-17T17:00:00.000Z');
    expect(dayKeyInTimezone(afterMidnight, TZ)).toBe('tue');
    const hours = { mon: { open: '18:00', close: '02:00' } };
    expect(isBranchOpenNow(branch({ openingHours: hours }), afterMidnight)).toBe(true);
  });

  it('handles an overnight window: closed once past the spillover close time', () => {
    // 2026-08-17T19:00:00Z = 2026-08-18 03:00 Manila — Tuesday, past the 02:00 close.
    // Tuesday's own entry is configured (and doesn't cover 3am either), so
    // this exercises "spillover ended" rather than the missing-config
    // default — see the next test for that default on its own.
    const pastClose = new Date('2026-08-17T19:00:00.000Z');
    const hours = {
      mon: { open: '18:00', close: '02:00' },
      tue: { open: '09:00', close: '22:00' },
    };
    expect(isBranchOpenNow(branch({ openingHours: hours }), pastClose)).toBe(false);
  });

  it('falls back to the missing-config default when tomorrow has no entry either', () => {
    // Same instant as above, but only Monday is configured — Tuesday has no
    // entry at all, so the missing-config default ("open") applies once the
    // overnight spillover from Monday has ended.
    const pastClose = new Date('2026-08-17T19:00:00.000Z');
    const hours = { mon: { open: '18:00', close: '02:00' } };
    expect(isBranchOpenNow(branch({ openingHours: hours }), pastClose)).toBe(true);
  });
});
