import { describe, it, expect } from 'vitest';
import {
  createReservationSchema,
  updateReservationStatusSchema,
  recordDepositSchema,
} from '@/lib/validation/reservation';

describe('createReservationSchema', () => {
  const base = {
    tableIds: ['t1'],
    startAt: '2026-09-05T18:00:00.000Z',
    guestCount: 2,
    guestName: 'Juan Dela Cruz',
  };

  it('accepts a minimal valid reservation', () => {
    expect(createReservationSchema.safeParse(base).success).toBe(true);
  });

  it('defaults durationMinutes to 90', () => {
    const result = createReservationSchema.parse(base);
    expect(result.durationMinutes).toBe(90);
  });

  it('rejects an empty tableIds array', () => {
    expect(createReservationSchema.safeParse({ ...base, tableIds: [] }).success).toBe(false);
  });

  it('rejects a zero guest count', () => {
    expect(createReservationSchema.safeParse({ ...base, guestCount: 0 }).success).toBe(false);
  });

  it('rejects an empty guest name', () => {
    expect(createReservationSchema.safeParse({ ...base, guestName: '' }).success).toBe(false);
  });

  it('rejects durationMinutes outside 30-480', () => {
    expect(createReservationSchema.safeParse({ ...base, durationMinutes: 15 }).success).toBe(false);
    expect(createReservationSchema.safeParse({ ...base, durationMinutes: 600 }).success).toBe(false);
  });

  it('requires depositAmount when depositRequired is true', () => {
    expect(
      createReservationSchema.safeParse({ ...base, depositRequired: true }).success,
    ).toBe(false);
    expect(
      createReservationSchema.safeParse({ ...base, depositRequired: true, depositAmount: '500.00' })
        .success,
    ).toBe(true);
  });

  it('rejects a malformed deposit amount', () => {
    expect(
      createReservationSchema.safeParse({
        ...base,
        depositRequired: true,
        depositAmount: 'not-a-number',
      }).success,
    ).toBe(false);
  });
});

describe('updateReservationStatusSchema', () => {
  it('accepts every documented status', () => {
    for (const status of ['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) {
      expect(updateReservationStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects an undocumented status', () => {
    expect(updateReservationStatusSchema.safeParse({ status: 'ARRIVED' }).success).toBe(false);
  });
});

describe('recordDepositSchema', () => {
  it('accepts a valid deposit record', () => {
    expect(
      recordDepositSchema.safeParse({ depositStatus: 'PAID', depositAmount: '500.00' }).success,
    ).toBe(true);
  });

  it('rejects an undocumented deposit status', () => {
    expect(recordDepositSchema.safeParse({ depositStatus: 'PARTIAL' }).success).toBe(false);
  });
});
