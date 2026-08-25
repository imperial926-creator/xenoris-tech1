import { describe, it, expect } from 'vitest';
import { classifySegment, resolveRfmThresholds, DEFAULT_RFM_THRESHOLDS } from '@/lib/crm/rfm';

describe('classifySegment', () => {
  it('classifies a customer with zero transactions as NEW', () => {
    expect(classifySegment({ recencyDays: null, frequency: 0, monetary: '0.00' })).toBe('NEW');
  });

  it('classifies a customer with exactly one transaction as NEW', () => {
    expect(classifySegment({ recencyDays: 5, frequency: 1, monetary: '500.00' })).toBe('NEW');
  });

  it('classifies a single very large transaction as HIGH_VALUE, not NEW', () => {
    // Regression test for a real bug caught during Phase 8: HIGH_VALUE must
    // be checked before the frequency<=1 NEW rule, or a customer's first
    // ever (huge) purchase would always read as NEW.
    expect(classifySegment({ recencyDays: 1, frequency: 1, monetary: '150000.00' })).toBe('HIGH_VALUE');
  });

  it('classifies high spend as HIGH_VALUE regardless of frequency/recency', () => {
    expect(classifySegment({ recencyDays: 400, frequency: 20, monetary: '999999.99' })).toBe('HIGH_VALUE');
  });

  it('classifies a long-dormant customer as INACTIVE', () => {
    expect(classifySegment({ recencyDays: 200, frequency: 3, monetary: '1000.00' })).toBe('INACTIVE');
  });

  it('classifies a customer who has gone quiet (but not fully inactive) as AT_RISK', () => {
    expect(classifySegment({ recencyDays: 100, frequency: 3, monetary: '1000.00' })).toBe('AT_RISK');
  });

  it('classifies frequent + high-spend as VIP', () => {
    expect(classifySegment({ recencyDays: 5, frequency: 12, monetary: '60000.00' })).toBe('VIP');
  });

  it('does not classify frequent-but-low-spend as VIP — falls through to REGULAR', () => {
    expect(classifySegment({ recencyDays: 5, frequency: 12, monetary: '1000.00' })).toBe('REGULAR');
  });

  it('classifies frequent (but not VIP-spend) as REGULAR', () => {
    expect(classifySegment({ recencyDays: 5, frequency: 6, monetary: '2000.00' })).toBe('REGULAR');
  });

  it('classifies everything else as RETURNING', () => {
    expect(classifySegment({ recencyDays: 5, frequency: 2, monetary: '900.00' })).toBe('RETURNING');
  });

  it('treats a null recencyDays (never transacted via a dated record) as never triggering INACTIVE/AT_RISK', () => {
    // frequency 3 (so not NEW), monetary low (not HIGH_VALUE), recencyDays
    // null — INACTIVE/AT_RISK checks are skipped, falls through to RETURNING.
    expect(classifySegment({ recencyDays: null, frequency: 3, monetary: '100.00' })).toBe('RETURNING');
  });

  it('respects custom thresholds over the defaults', () => {
    const tightThresholds = { ...DEFAULT_RFM_THRESHOLDS, regularMinTransactions: 2 };
    expect(classifySegment({ recencyDays: 5, frequency: 2, monetary: '100.00' }, tightThresholds)).toBe('REGULAR');
  });
});

describe('resolveRfmThresholds', () => {
  it('returns the defaults when crmSettings is null/undefined', () => {
    expect(resolveRfmThresholds(null)).toEqual(DEFAULT_RFM_THRESHOLDS);
    expect(resolveRfmThresholds(undefined)).toEqual(DEFAULT_RFM_THRESHOLDS);
  });

  it('returns the defaults when crmSettings has no rfmThresholds key', () => {
    expect(resolveRfmThresholds({ someOtherSetting: true })).toEqual(DEFAULT_RFM_THRESHOLDS);
  });

  it('merges a valid numeric override over the defaults, field by field', () => {
    const result = resolveRfmThresholds({ rfmThresholds: { vipMinTransactions: 3 } });
    expect(result.vipMinTransactions).toBe(3);
    expect(result.inactiveDays).toBe(DEFAULT_RFM_THRESHOLDS.inactiveDays);
  });

  it('merges a valid money-string override over the defaults', () => {
    const result = resolveRfmThresholds({ rfmThresholds: { vipMinSpend: '75000.00' } });
    expect(result.vipMinSpend).toBe('75000.00');
    expect(result.highValueMinSpend).toBe(DEFAULT_RFM_THRESHOLDS.highValueMinSpend);
  });

  it('ignores a malformed override and falls back to that field default', () => {
    const result = resolveRfmThresholds({ rfmThresholds: { inactiveDays: 'not a number', vipMinSpend: 'free' } });
    expect(result.inactiveDays).toBe(DEFAULT_RFM_THRESHOLDS.inactiveDays);
    expect(result.vipMinSpend).toBe(DEFAULT_RFM_THRESHOLDS.vipMinSpend);
  });

  it('ignores a negative numeric override', () => {
    const result = resolveRfmThresholds({ rfmThresholds: { atRiskDays: -5 } });
    expect(result.atRiskDays).toBe(DEFAULT_RFM_THRESHOLDS.atRiskDays);
  });
});
