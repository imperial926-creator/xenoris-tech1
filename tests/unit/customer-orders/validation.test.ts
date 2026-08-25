import { describe, it, expect } from 'vitest';
import {
  customerCreateOrderSchema,
  customerListOrdersQuerySchema,
} from '@/lib/validation/customer-order';

describe('customerCreateOrderSchema', () => {
  const takeoutBase = {
    items: [{ menuItemId: 'item-1', quantity: 1, modifierIds: [] }],
    pickupTime: '2026-09-05T18:00:00.000Z',
    paymentMethod: 'CASH',
  };

  it('accepts a minimal valid take-out order, defaulting type to TAKEOUT', () => {
    const result = customerCreateOrderSchema.safeParse(takeoutBase);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe('TAKEOUT');
  });

  it('rejects an empty items array', () => {
    expect(customerCreateOrderSchema.safeParse({ ...takeoutBase, items: [] }).success).toBe(false);
  });

  it('rejects a TAKEOUT order missing pickupTime', () => {
    const { pickupTime: _pickupTime, ...withoutPickupTime } = takeoutBase;
    expect(customerCreateOrderSchema.safeParse(withoutPickupTime).success).toBe(false);
  });

  it('rejects an undocumented payment method', () => {
    expect(customerCreateOrderSchema.safeParse({ ...takeoutBase, paymentMethod: 'CRYPTO' }).success).toBe(false);
  });

  it('accepts every documented payment method', () => {
    for (const method of ['CASH', 'CARD', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER']) {
      expect(customerCreateOrderSchema.safeParse({ ...takeoutBase, paymentMethod: method }).success).toBe(true);
    }
  });

  it('rejects a DINE_IN type, tableId, or guest contact fields — those are server-resolved / not app-orderable', () => {
    const parsed = customerCreateOrderSchema.parse({
      ...takeoutBase,
      tableId: 'table-1',
      guestName: 'Someone Else',
      guestEmail: 'someone@else.com',
      discountAmount: '100.00',
    });
    expect(parsed).not.toHaveProperty('tableId');
    expect(parsed).not.toHaveProperty('guestName');
    expect(parsed).not.toHaveProperty('guestEmail');
    expect(parsed).not.toHaveProperty('discountAmount');
    expect(customerCreateOrderSchema.safeParse({ ...takeoutBase, type: 'DINE_IN' }).success).toBe(false);
  });

  it('accepts optional special instructions per item and for the whole order', () => {
    const result = customerCreateOrderSchema.parse({
      ...takeoutBase,
      items: [{ menuItemId: 'item-1', quantity: 1, modifierIds: [], notes: 'No onions' }],
      notes: 'Ring the bell at pickup',
    });
    expect(result.items[0].notes).toBe('No onions');
    expect(result.notes).toBe('Ring the bell at pickup');
  });

  it('rejects a zero quantity', () => {
    expect(
      customerCreateOrderSchema.safeParse({
        ...takeoutBase,
        items: [{ menuItemId: 'item-1', quantity: 0, modifierIds: [] }],
      }).success,
    ).toBe(false);
  });

  // --- CAPP Phase 5: DELIVERY --------------------------------------------

  const deliveryBase = {
    items: [{ menuItemId: 'item-1', quantity: 1, modifierIds: [] }],
    type: 'DELIVERY' as const,
    deliveryZoneId: 'zone-1',
    deliveryAddressId: 'address-1',
    paymentMethod: 'CASH',
  };

  it('accepts a minimal valid delivery order with a saved address id', () => {
    expect(customerCreateOrderSchema.safeParse(deliveryBase).success).toBe(true);
  });

  it('accepts a delivery order with freeform deliveryAddress instead of a saved address id', () => {
    const { deliveryAddressId: _id, ...rest } = deliveryBase;
    expect(
      customerCreateOrderSchema.safeParse({ ...rest, deliveryAddress: '123 Rizal St, Manila' }).success,
    ).toBe(true);
  });

  it('does not require pickupTime for a delivery order', () => {
    expect(customerCreateOrderSchema.safeParse(deliveryBase).success).toBe(true);
  });

  it('rejects a delivery order missing deliveryZoneId', () => {
    const { deliveryZoneId: _zone, ...withoutZone } = deliveryBase;
    expect(customerCreateOrderSchema.safeParse(withoutZone).success).toBe(false);
  });

  it('rejects a delivery order with neither deliveryAddressId nor deliveryAddress', () => {
    const { deliveryAddressId: _id, ...withoutAddress } = deliveryBase;
    expect(customerCreateOrderSchema.safeParse(withoutAddress).success).toBe(false);
  });
});

describe('customerListOrdersQuerySchema', () => {
  it('defaults pagination the same way the shared pagination schema does', () => {
    const result = customerListOrdersQuerySchema.parse({});
    expect(result.take).toBe(50);
    expect(result.skip).toBe(0);
  });

  it('coerces openOnly from a query-string "true"', () => {
    const result = customerListOrdersQuerySchema.parse({ openOnly: 'true' });
    expect(result.openOnly).toBe(true);
  });

  it('accepts an optional type filter of TAKEOUT or DELIVERY', () => {
    expect(customerListOrdersQuerySchema.safeParse({ type: 'DELIVERY' }).success).toBe(true);
    expect(customerListOrdersQuerySchema.safeParse({ type: 'DINE_IN' }).success).toBe(false);
  });
});
