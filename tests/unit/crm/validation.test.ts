import { describe, it, expect } from 'vitest';
import {
  createCustomerSchema,
  updateCustomerSchema,
  createCustomerAddressSchema,
  setCustomerPreferenceSchema,
  createCustomerNoteSchema,
  createCustomerTagSchema,
  createCustomerReviewSchema,
  listCustomersQuerySchema,
} from '@/lib/validation/crm';

describe('createCustomerSchema', () => {
  it('accepts a minimal customer with just a first name', () => {
    expect(createCustomerSchema.safeParse({ firstName: 'Grace' }).success).toBe(true);
  });

  it('rejects a missing firstName', () => {
    expect(createCustomerSchema.safeParse({ lastName: 'Villanueva' }).success).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(createCustomerSchema.safeParse({ firstName: 'Grace', email: 'not-an-email' }).success).toBe(false);
  });
});

describe('updateCustomerSchema', () => {
  it('accepts a status-only partial update', () => {
    expect(updateCustomerSchema.safeParse({ status: 'BLOCKED' }).success).toBe(true);
  });

  it('rejects an undocumented status', () => {
    expect(updateCustomerSchema.safeParse({ status: 'VIP' }).success).toBe(false);
  });

  it('does not accept userId on update (only settable at creation)', () => {
    const result = updateCustomerSchema.safeParse({ userId: 'user1', firstName: 'Grace' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('userId' in result.data).toBe(false);
    }
  });
});

describe('createCustomerAddressSchema', () => {
  it('accepts a minimal address and defaults country to PH', () => {
    const result = createCustomerAddressSchema.parse({ line1: '123 Rizal St' });
    expect(result.country).toBe('PH');
    expect(result.isDefault).toBe(false);
  });

  it('rejects a missing line1', () => {
    expect(createCustomerAddressSchema.safeParse({ city: 'Makati' }).success).toBe(false);
  });
});

describe('setCustomerPreferenceSchema', () => {
  it('accepts a valid key/value pair', () => {
    expect(setCustomerPreferenceSchema.safeParse({ key: 'dietary', value: 'vegetarian' }).success).toBe(true);
  });

  it('rejects an empty value', () => {
    expect(setCustomerPreferenceSchema.safeParse({ key: 'dietary', value: '' }).success).toBe(false);
  });
});

describe('createCustomerNoteSchema', () => {
  it('rejects an empty note', () => {
    expect(createCustomerNoteSchema.safeParse({ note: '' }).success).toBe(false);
  });
});

describe('createCustomerTagSchema', () => {
  it('rejects an empty tag', () => {
    expect(createCustomerTagSchema.safeParse({ tag: '' }).success).toBe(false);
  });
});

describe('createCustomerReviewSchema', () => {
  it('accepts a standalone review with no linked records', () => {
    expect(createCustomerReviewSchema.safeParse({ rating: 4 }).success).toBe(true);
  });

  it('rejects a rating outside 1-5', () => {
    expect(createCustomerReviewSchema.safeParse({ rating: 6 }).success).toBe(false);
    expect(createCustomerReviewSchema.safeParse({ rating: 0 }).success).toBe(false);
  });

  it('rejects a non-integer rating', () => {
    expect(createCustomerReviewSchema.safeParse({ rating: 4.5 }).success).toBe(false);
  });
});

describe('listCustomersQuerySchema', () => {
  it('accepts an empty query', () => {
    expect(listCustomersQuerySchema.safeParse({}).success).toBe(true);
  });

  it('rejects an undocumented status filter', () => {
    expect(listCustomersQuerySchema.safeParse({ status: 'VIP' }).success).toBe(false);
  });
});
