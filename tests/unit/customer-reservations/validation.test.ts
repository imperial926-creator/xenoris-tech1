import { describe, it, expect } from 'vitest';
import {
  customerAvailabilityQuerySchema,
  customerCreateReservationSchema,
  customerListReservationsQuerySchema,
} from '@/lib/validation/customer-reservation';

describe('customerAvailabilityQuerySchema', () => {
  it('defaults durationMinutes to 90 and guestCount to 2', () => {
    const result = customerAvailabilityQuerySchema.parse({ startAt: '2026-09-05T18:00:00.000Z' });
    expect(result.durationMinutes).toBe(90);
    expect(result.guestCount).toBe(2);
  });

  it('rejects a missing startAt', () => {
    expect(customerAvailabilityQuerySchema.safeParse({}).success).toBe(false);
  });

  it('rejects a guestCount above the sane per-booking cap', () => {
    expect(
      customerAvailabilityQuerySchema.safeParse({ startAt: '2026-09-05T18:00:00.000Z', guestCount: 500 })
        .success,
    ).toBe(false);
  });
});

describe('customerCreateReservationSchema', () => {
  const base = { startAt: '2026-09-05T18:00:00.000Z', durationMinutes: 90, guestCount: 2 };

  it('accepts a minimal booking with no seating preference or special request', () => {
    expect(customerCreateReservationSchema.safeParse(base).success).toBe(true);
  });

  it('never accepts a tableIds field — table assignment is server-side only', () => {
    const parsed = customerCreateReservationSchema.parse({ ...base, tableIds: ['t1'] });
    expect(parsed).not.toHaveProperty('tableIds');
  });

  it('never accepts guestName/guestEmail/guestPhone — sourced from the authenticated profile', () => {
    const parsed = customerCreateReservationSchema.parse({
      ...base,
      guestName: 'Someone Else',
      guestEmail: 'someone@else.com',
    });
    expect(parsed).not.toHaveProperty('guestName');
    expect(parsed).not.toHaveProperty('guestEmail');
  });

  it('accepts an optional seating preference and special request', () => {
    const result = customerCreateReservationSchema.parse({
      ...base,
      seatingPreference: 'outdoor',
      specialRequests: 'Birthday celebration, window seat please.',
    });
    expect(result.seatingPreference).toBe('outdoor');
  });

  it('rejects a zero guest count', () => {
    expect(customerCreateReservationSchema.safeParse({ ...base, guestCount: 0 }).success).toBe(false);
  });
});

describe('customerListReservationsQuerySchema', () => {
  it('defaults pagination the same way the shared pagination schema does', () => {
    const result = customerListReservationsQuerySchema.parse({});
    expect(result.take).toBe(50);
    expect(result.skip).toBe(0);
  });

  it('coerces upcomingOnly from a query-string "true"', () => {
    const result = customerListReservationsQuerySchema.parse({ upcomingOnly: 'true' });
    expect(result.upcomingOnly).toBe(true);
  });
});
