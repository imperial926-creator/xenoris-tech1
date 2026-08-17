import { describe, it, expect } from 'vitest';
import { reportDateRangeQuerySchema, balanceSheetQuerySchema, financialDashboardQuerySchema } from '@/lib/validation/reporting';

describe('reportDateRangeQuerySchema', () => {
  it('defaults preset to this_month when omitted', () => {
    expect(reportDateRangeQuerySchema.parse({}).preset).toBe('this_month');
  });

  it('accepts every documented preset', () => {
    for (const preset of ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'this_year']) {
      expect(reportDateRangeQuerySchema.safeParse({ preset }).success).toBe(true);
    }
  });

  it('rejects an unknown preset', () => {
    expect(reportDateRangeQuerySchema.safeParse({ preset: 'last_decade' }).success).toBe(false);
  });

  it('requires startDate and endDate when preset is custom', () => {
    expect(reportDateRangeQuerySchema.safeParse({ preset: 'custom' }).success).toBe(false);
    expect(reportDateRangeQuerySchema.safeParse({ preset: 'custom', startDate: '2026-01-01' }).success).toBe(false);
    expect(reportDateRangeQuerySchema.safeParse({ preset: 'custom', startDate: '2026-01-01', endDate: '2026-01-31' }).success).toBe(true);
  });

  it('accepts an optional branchId', () => {
    const result = reportDateRangeQuerySchema.parse({ preset: 'this_month', branchId: 'branch_1' });
    expect(result.branchId).toBe('branch_1');
  });
});

describe('balanceSheetQuerySchema', () => {
  it('allows an empty query (defaults resolved server-side to "now")', () => {
    expect(balanceSheetQuerySchema.safeParse({}).success).toBe(true);
  });

  it('accepts an asOfDate and branchId', () => {
    const result = balanceSheetQuerySchema.parse({ asOfDate: '2026-08-31', branchId: 'branch_1' });
    expect(result.asOfDate).toBe('2026-08-31');
    expect(result.branchId).toBe('branch_1');
  });
});

describe('financialDashboardQuerySchema', () => {
  it('allows an empty query and an optional branchId', () => {
    expect(financialDashboardQuerySchema.safeParse({}).success).toBe(true);
    expect(financialDashboardQuerySchema.parse({ branchId: 'branch_1' }).branchId).toBe('branch_1');
  });
});
