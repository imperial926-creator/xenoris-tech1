import { describe, it, expect } from 'vitest';
import {
  createDeliveryZoneSchema,
  updateDeliveryZoneSchema,
  createDriverSchema,
  updateDriverSchema,
  assignDriverSchema,
  updateDeliveryStatusSchema,
  listDeliveriesQuerySchema,
} from '@/lib/validation/delivery';

describe('createDeliveryZoneSchema', () => {
  it('accepts a minimal valid zone and defaults deliveryFee to 0.00', () => {
    const result = createDeliveryZoneSchema.parse({ name: 'Downtown' });
    expect(result.deliveryFee).toBe('0.00');
  });

  it('rejects a missing name', () => {
    expect(createDeliveryZoneSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a malformed deliveryFee', () => {
    expect(createDeliveryZoneSchema.safeParse({ name: 'Downtown', deliveryFee: 'free' }).success).toBe(false);
  });

  it('accepts a numeric deliveryFee, coerced to a string', () => {
    const result = createDeliveryZoneSchema.parse({ name: 'Downtown', deliveryFee: 50 });
    expect(result.deliveryFee).toBe('50');
  });
});

describe('updateDeliveryZoneSchema', () => {
  it('accepts a partial update with only active', () => {
    expect(updateDeliveryZoneSchema.safeParse({ active: false }).success).toBe(true);
  });

  it('accepts an empty object (no-op update)', () => {
    expect(updateDeliveryZoneSchema.safeParse({}).success).toBe(true);
  });
});

describe('createDriverSchema', () => {
  it('accepts a minimal valid driver with only userId', () => {
    expect(createDriverSchema.safeParse({ userId: 'user1' }).success).toBe(true);
  });

  it('rejects a missing userId', () => {
    expect(createDriverSchema.safeParse({ vehicleType: 'Motorcycle' }).success).toBe(false);
  });
});

describe('updateDriverSchema', () => {
  it('does not accept userId (immutable after creation)', () => {
    const result = updateDriverSchema.safeParse({ userId: 'user1', active: false });
    // userId is stripped by .omit, so it should not appear on the parsed result.
    expect(result.success).toBe(true);
    if (result.success) expect('userId' in result.data).toBe(false);
  });

  it('accepts an empty object (no-op update)', () => {
    expect(updateDriverSchema.safeParse({}).success).toBe(true);
  });
});

describe('assignDriverSchema', () => {
  it('accepts a valid driverId with no note', () => {
    expect(assignDriverSchema.safeParse({ driverId: 'driver1' }).success).toBe(true);
  });

  it('rejects a missing driverId', () => {
    expect(assignDriverSchema.safeParse({ note: 'Rush order' }).success).toBe(false);
  });
});

describe('updateDeliveryStatusSchema', () => {
  it('accepts every documented status', () => {
    for (const status of ['UNASSIGNED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'FAILED', 'CANCELLED']) {
      expect(updateDeliveryStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects an undocumented status', () => {
    expect(updateDeliveryStatusSchema.safeParse({ status: 'IN_TRANSIT' }).success).toBe(false);
  });

  it('accepts an optional proofOfDeliveryNote and recipientName', () => {
    const result = updateDeliveryStatusSchema.safeParse({
      status: 'DELIVERED',
      proofOfDeliveryNote: 'Left with security guard.',
      recipientName: 'Front desk',
    });
    expect(result.success).toBe(true);
  });
});

describe('listDeliveriesQuerySchema', () => {
  it('accepts an empty query (no status filter)', () => {
    expect(listDeliveriesQuerySchema.safeParse({}).success).toBe(true);
  });

  it('rejects an undocumented status filter', () => {
    expect(listDeliveriesQuerySchema.safeParse({ status: 'IN_TRANSIT' }).success).toBe(false);
  });
});
