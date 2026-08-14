import { describe, it, expect } from 'vitest';
import { createOrderSchema, recordOrderPaymentSchema, updateOrderStatusSchema } from '@/lib/validation/order';

describe('createOrderSchema', () => {
  const base = {
    type: 'TAKEOUT' as const,
    items: [{ menuItemId: 'item1', quantity: 2, modifierIds: [] }],
  };

  it('accepts a minimal valid takeout order', () => {
    expect(createOrderSchema.safeParse(base).success).toBe(true);
  });

  it('defaults discountAmount to 0.00', () => {
    const result = createOrderSchema.parse(base);
    expect(result.discountAmount).toBe('0.00');
  });

  it('rejects an order with no items', () => {
    expect(createOrderSchema.safeParse({ ...base, items: [] }).success).toBe(false);
  });

  it('requires deliveryAddress for DELIVERY orders', () => {
    expect(createOrderSchema.safeParse({ ...base, type: 'DELIVERY' }).success).toBe(false);
    expect(
      createOrderSchema.safeParse({ ...base, type: 'DELIVERY', deliveryAddress: '123 Main St' }).success,
    ).toBe(true);
  });

  it('does not require deliveryAddress for DINE_IN or TAKEOUT', () => {
    expect(createOrderSchema.safeParse({ ...base, type: 'DINE_IN' }).success).toBe(true);
    expect(createOrderSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a quantity outside 1-50', () => {
    expect(
      createOrderSchema.safeParse({
        ...base,
        items: [{ menuItemId: 'item1', quantity: 0, modifierIds: [] }],
      }).success,
    ).toBe(false);
    expect(
      createOrderSchema.safeParse({
        ...base,
        items: [{ menuItemId: 'item1', quantity: 51, modifierIds: [] }],
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed discount amount', () => {
    expect(createOrderSchema.safeParse({ ...base, discountAmount: 'free' }).success).toBe(false);
  });
});

describe('updateOrderStatusSchema', () => {
  it('accepts every documented status', () => {
    for (const status of ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED']) {
      expect(updateOrderStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects an undocumented status', () => {
    expect(updateOrderStatusSchema.safeParse({ status: 'DELIVERED' }).success).toBe(false);
  });
});

describe('recordOrderPaymentSchema', () => {
  it('accepts a valid payment record and defaults status to COMPLETED', () => {
    const result = recordOrderPaymentSchema.parse({ method: 'CASH', amount: '218.40' });
    expect(result.status).toBe('COMPLETED');
  });

  it('rejects an undocumented payment method', () => {
    expect(recordOrderPaymentSchema.safeParse({ method: 'CRYPTO', amount: '100.00' }).success).toBe(false);
  });

  it('rejects a malformed amount', () => {
    expect(recordOrderPaymentSchema.safeParse({ method: 'CASH', amount: 'lots' }).success).toBe(false);
  });
});
