import { describe, it, expect } from 'vitest';
import { createTableSchema, updateTableStatusSchema } from '@/lib/validation/table';

describe('table validation', () => {
  it('accepts a valid table', () => {
    const result = createTableSchema.safeParse({ tableNumber: 'T1', capacity: 4 });
    expect(result.success).toBe(true);
  });

  it('rejects zero capacity', () => {
    const result = createTableSchema.safeParse({ tableNumber: 'T1', capacity: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer capacity', () => {
    const result = createTableSchema.safeParse({ tableNumber: 'T1', capacity: 4.5 });
    expect(result.success).toBe(false);
  });

  it('rejects an empty table number', () => {
    const result = createTableSchema.safeParse({ tableNumber: '', capacity: 4 });
    expect(result.success).toBe(false);
  });
});

describe('table status validation', () => {
  it('accepts every documented status', () => {
    for (const status of ['AVAILABLE', 'RESERVED', 'OCCUPIED', 'WAITING', 'CLEANING', 'OUT_OF_SERVICE']) {
      expect(updateTableStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects an undocumented status', () => {
    expect(updateTableStatusSchema.safeParse({ status: 'ON_FIRE' }).success).toBe(false);
  });
});
