import { describe, it, expect } from 'vitest';
import {
  customerCreateCateringInquirySchema,
  customerListCateringInquiriesQuerySchema,
  customerQuoteResponseSchema,
  customerQuoteChangeRequestSchema,
  customerCateringPaymentSchema,
} from '@/lib/validation/customer-catering';

describe('customerCreateCateringInquirySchema', () => {
  const base = {
    eventType: 'Wedding',
    eventDate: '2026-12-05T10:00:00.000Z',
    location: 'Grand Ballroom, Makati',
    guestCount: 150,
  };

  it('accepts a minimal valid inquiry', () => {
    expect(customerCreateCateringInquirySchema.safeParse(base).success).toBe(true);
  });

  it('accepts an inquiry with budget, menu preferences, and special requests', () => {
    const result = customerCreateCateringInquirySchema.safeParse({
      ...base,
      budget: '50000.00',
      menuRequirements: 'No pork, one vegan station',
      specialRequests: 'Need a projector',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.budget).toBe('50000.00');
    }
  });

  it('accepts a numeric budget and coerces it to a money string', () => {
    const result = customerCreateCateringInquirySchema.safeParse({ ...base, budget: 50000 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.budget).toBe('50000');
  });

  it('rejects a malformed budget', () => {
    expect(customerCreateCateringInquirySchema.safeParse({ ...base, budget: 'a lot' }).success).toBe(false);
  });

  it('rejects a missing eventType, location, or guestCount', () => {
    const { eventType: _e, ...withoutEventType } = base;
    expect(customerCreateCateringInquirySchema.safeParse(withoutEventType).success).toBe(false);
    const { location: _l, ...withoutLocation } = base;
    expect(customerCreateCateringInquirySchema.safeParse(withoutLocation).success).toBe(false);
    const { guestCount: _g, ...withoutGuestCount } = base;
    expect(customerCreateCateringInquirySchema.safeParse(withoutGuestCount).success).toBe(false);
  });

  it('rejects a zero or negative guestCount', () => {
    expect(customerCreateCateringInquirySchema.safeParse({ ...base, guestCount: 0 }).success).toBe(false);
    expect(customerCreateCateringInquirySchema.safeParse({ ...base, guestCount: -5 }).success).toBe(false);
  });

  it('does not accept staff-only fields like customerId, packageId, or equipmentRequests', () => {
    const parsed = customerCreateCateringInquirySchema.parse({
      ...base,
      customerId: 'cust-1',
      packageId: 'pkg-1',
      equipmentRequests: 'Tables and chairs',
      staffRequests: '5 servers',
      setupRequests: 'Setup by 9am',
      deliveryRequested: true,
      deliveryAddress: 'Somewhere',
    });
    expect(parsed).not.toHaveProperty('customerId');
    expect(parsed).not.toHaveProperty('packageId');
    expect(parsed).not.toHaveProperty('equipmentRequests');
    expect(parsed).not.toHaveProperty('staffRequests');
    expect(parsed).not.toHaveProperty('setupRequests');
    expect(parsed).not.toHaveProperty('deliveryRequested');
    expect(parsed).not.toHaveProperty('deliveryAddress');
  });
});

describe('customerListCateringInquiriesQuerySchema', () => {
  it('defaults pagination the same way the shared pagination schema does', () => {
    const result = customerListCateringInquiriesQuerySchema.parse({});
    expect(result.take).toBe(50);
    expect(result.skip).toBe(0);
  });
});

describe('customerQuoteResponseSchema', () => {
  it('accepts an Accept with no rejectionReason', () => {
    expect(customerQuoteResponseSchema.safeParse({ status: 'ACCEPTED' }).success).toBe(true);
  });

  it('rejects a Decline with no rejectionReason', () => {
    expect(customerQuoteResponseSchema.safeParse({ status: 'REJECTED' }).success).toBe(false);
  });

  it('accepts a Decline with a rejectionReason', () => {
    expect(
      customerQuoteResponseSchema.safeParse({ status: 'REJECTED', rejectionReason: 'Too expensive' }).success,
    ).toBe(true);
  });

  it('rejects a status outside ACCEPTED/REJECTED', () => {
    expect(customerQuoteResponseSchema.safeParse({ status: 'EXPIRED' }).success).toBe(false);
  });
});

describe('customerQuoteChangeRequestSchema', () => {
  it('accepts a non-empty note', () => {
    expect(customerQuoteChangeRequestSchema.safeParse({ note: 'Can we swap the dessert station?' }).success).toBe(
      true,
    );
  });

  it('rejects an empty note', () => {
    expect(customerQuoteChangeRequestSchema.safeParse({ note: '' }).success).toBe(false);
  });
});

describe('customerCateringPaymentSchema', () => {
  const base = { type: 'DEPOSIT' as const, method: 'GCASH' as const, amount: '5000.00' };

  it('accepts a valid deposit payment', () => {
    expect(customerCateringPaymentSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a BALANCE payment type', () => {
    expect(customerCateringPaymentSchema.safeParse({ ...base, type: 'BALANCE' }).success).toBe(true);
  });

  it('rejects a zero or negative amount', () => {
    expect(customerCateringPaymentSchema.safeParse({ ...base, amount: '0' }).success).toBe(false);
    expect(customerCateringPaymentSchema.safeParse({ ...base, amount: '-100.00' }).success).toBe(false);
  });

  it('rejects an undocumented payment method', () => {
    expect(customerCateringPaymentSchema.safeParse({ ...base, method: 'CRYPTO' }).success).toBe(false);
  });
});
