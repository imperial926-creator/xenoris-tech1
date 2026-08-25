import { describe, it, expect } from 'vitest';
import {
  createCateringPackageSchema,
  updateCateringPackageSchema,
  createCateringInquirySchema,
  updateCateringInquirySchema,
  createCateringQuoteSchema,
  updateCateringQuoteStatusSchema,
  updateCateringEventStatusSchema,
  recordCateringPaymentSchema,
  listCateringInquiriesQuerySchema,
} from '@/lib/validation/catering';

describe('createCateringPackageSchema', () => {
  it('accepts a minimal valid package', () => {
    expect(createCateringPackageSchema.safeParse({ name: 'Silver', pricePerGuest: '500.00' }).success).toBe(true);
  });

  it('rejects a missing pricePerGuest', () => {
    expect(createCateringPackageSchema.safeParse({ name: 'Silver' }).success).toBe(false);
  });

  it('rejects a malformed pricePerGuest', () => {
    expect(createCateringPackageSchema.safeParse({ name: 'Silver', pricePerGuest: 'free' }).success).toBe(false);
  });
});

describe('updateCateringPackageSchema', () => {
  it('accepts an active-only partial update', () => {
    expect(updateCateringPackageSchema.safeParse({ active: false }).success).toBe(true);
  });
});

describe('createCateringInquirySchema', () => {
  const base = {
    eventType: 'Wedding',
    eventDate: '2026-12-01T18:00:00.000Z',
    location: 'Grand Ballroom',
    guestCount: 100,
  };

  it('accepts a minimal valid inquiry', () => {
    expect(createCateringInquirySchema.safeParse(base).success).toBe(true);
  });

  it('defaults deliveryRequested to false', () => {
    expect(createCateringInquirySchema.parse(base).deliveryRequested).toBe(false);
  });

  it('rejects a guestCount of 0', () => {
    expect(createCateringInquirySchema.safeParse({ ...base, guestCount: 0 }).success).toBe(false);
  });

  it('rejects a missing eventType/location/eventDate', () => {
    expect(createCateringInquirySchema.safeParse({ guestCount: 10 }).success).toBe(false);
  });
});

describe('updateCateringInquirySchema', () => {
  it('accepts a status-only partial update', () => {
    expect(updateCateringInquirySchema.safeParse({ status: 'CANCELLED' }).success).toBe(true);
  });

  it('rejects an undocumented status', () => {
    expect(updateCateringInquirySchema.safeParse({ status: 'ARCHIVED' }).success).toBe(false);
  });
});

describe('createCateringQuoteSchema', () => {
  const base = { inquiryId: 'inq1', guestCount: 30 };

  it('accepts a minimal quote and defaults fee totals to 0.00', () => {
    const result = createCateringQuoteSchema.parse(base);
    expect(result.staffingTotal).toBe('0.00');
    expect(result.equipmentTotal).toBe('0.00');
    expect(result.transportationTotal).toBe('0.00');
    expect(result.setupTotal).toBe('0.00');
    expect(result.serviceFeeTotal).toBe('0.00');
    expect(result.discountTotal).toBe('0.00');
    expect(result.items).toEqual([]);
  });

  it('accepts valid quote items', () => {
    const result = createCateringQuoteSchema.safeParse({
      ...base,
      items: [{ description: 'Silver Package (per guest)', quantity: 30, unitPrice: '500.00' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed item unitPrice', () => {
    const result = createCateringQuoteSchema.safeParse({
      ...base,
      items: [{ description: 'Bad item', quantity: 1, unitPrice: 'free' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing inquiryId', () => {
    expect(createCateringQuoteSchema.safeParse({ guestCount: 30 }).success).toBe(false);
  });
});

describe('updateCateringQuoteStatusSchema', () => {
  it('accepts every documented status', () => {
    for (const status of ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED']) {
      expect(updateCateringQuoteStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects an undocumented status', () => {
    expect(updateCateringQuoteStatusSchema.safeParse({ status: 'APPROVED' }).success).toBe(false);
  });
});

describe('updateCateringEventStatusSchema', () => {
  it('accepts every documented status', () => {
    for (const status of ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) {
      expect(updateCateringEventStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects an undocumented status', () => {
    expect(updateCateringEventStatusSchema.safeParse({ status: 'POSTPONED' }).success).toBe(false);
  });
});

describe('recordCateringPaymentSchema', () => {
  it('accepts a valid deposit payment and defaults status to COMPLETED', () => {
    const result = recordCateringPaymentSchema.parse({ type: 'DEPOSIT', method: 'BANK_TRANSFER', amount: '30000.00' });
    expect(result.status).toBe('COMPLETED');
  });

  it('rejects an undocumented payment type', () => {
    expect(recordCateringPaymentSchema.safeParse({ type: 'TIP', method: 'CASH', amount: '100.00' }).success).toBe(false);
  });

  it('rejects a malformed amount', () => {
    expect(recordCateringPaymentSchema.safeParse({ type: 'DEPOSIT', method: 'CASH', amount: 'lots' }).success).toBe(false);
  });
});

describe('listCateringInquiriesQuerySchema', () => {
  it('accepts an empty query', () => {
    expect(listCateringInquiriesQuerySchema.safeParse({}).success).toBe(true);
  });

  it('rejects an undocumented status filter', () => {
    expect(listCateringInquiriesQuerySchema.safeParse({ status: 'ARCHIVED' }).success).toBe(false);
  });
});
