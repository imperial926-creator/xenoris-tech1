import { Prisma } from '@prisma/client';

// Master spec §32. Pure, DB-free computation on purpose: CustomerService
// gathers the raw metrics (recency/frequency/monetary) from the database and
// hands them to classifySegment here, which contains zero Prisma queries —
// this is what actually makes the "no stored, no stale" design decision in
// schema.prisma's "Phase 8 — CRM" comment block (#4) testable in isolation.
export const CUSTOMER_SEGMENTS = [
  'NEW',
  'RETURNING',
  'REGULAR',
  'VIP',
  'AT_RISK',
  'INACTIVE',
  'HIGH_VALUE',
] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export interface RfmThresholds {
  /** Days since the last transaction beyond which a customer is INACTIVE. */
  inactiveDays: number;
  /** Days since the last transaction beyond which a customer is AT_RISK
   *  (evaluated only once INACTIVE has already been ruled out). */
  atRiskDays: number;
  /** Minimum all-time transaction count for REGULAR. */
  regularMinTransactions: number;
  /** Minimum all-time transaction count for VIP (combined with vipMinSpend). */
  vipMinTransactions: number;
  /** Minimum all-time spend (decimal string) for VIP, combined with
   *  vipMinTransactions — VIP requires both frequency AND spend. */
  vipMinSpend: string;
  /** Minimum all-time spend (decimal string) for HIGH_VALUE — spend alone,
   *  regardless of frequency/recency (e.g. one very large catering event). */
  highValueMinSpend: string;
}

/**
 * Sane defaults for a mid-size PH restaurant. Deliberately conservative —
 * these are starting points for a restaurant to tune, not a claim about
 * what "VIP" universally means. Master spec §32 says "make thresholds
 * configurable"; see resolveRfmThresholds below for the per-organization
 * override mechanism.
 */
export const DEFAULT_RFM_THRESHOLDS: RfmThresholds = {
  inactiveDays: 180,
  atRiskDays: 90,
  regularMinTransactions: 5,
  vipMinTransactions: 10,
  vipMinSpend: '50000.00',
  highValueMinSpend: '100000.00',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges Organization.crmSettings.rfmThresholds (arbitrary JSON from the DB)
 * over DEFAULT_RFM_THRESHOLDS, field by field, with defensive validation —
 * a malformed or missing override for one field silently falls back to that
 * field's default rather than throwing or corrupting the whole threshold
 * set. Accepts the raw crmSettings JSON value (or null/undefined) directly,
 * so callers don't need to know its shape ahead of time.
 */
export function resolveRfmThresholds(crmSettings: unknown): RfmThresholds {
  const overrides =
    isRecord(crmSettings) && isRecord(crmSettings.rfmThresholds) ? crmSettings.rfmThresholds : {};
  const result: RfmThresholds = { ...DEFAULT_RFM_THRESHOLDS };

  const numericKeys: Array<keyof RfmThresholds> = [
    'inactiveDays',
    'atRiskDays',
    'regularMinTransactions',
    'vipMinTransactions',
  ];
  for (const key of numericKeys) {
    const value = overrides[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      result[key] = value;
    }
  }

  const moneyKeys: Array<keyof RfmThresholds> = ['vipMinSpend', 'highValueMinSpend'];
  for (const key of moneyKeys) {
    const value = overrides[key];
    if (typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value)) {
      result[key] = value;
    }
  }

  return result;
}

export interface RfmMetrics {
  /** Days since the customer's most recent transaction, or null if they
   *  have never transacted. */
  recencyDays: number | null;
  /** Total transaction count (orders + catering events), all-time. */
  frequency: number;
  /** Total spend, all-time, as a decimal string. */
  monetary: string;
}

/**
 * Deterministic, single-label segment classification — evaluated in a fixed
 * precedence order (first match wins), not scored/weighted across axes.
 * Precedence, most to least specific:
 *   1. frequency <= 1              -> NEW (no history yet, or a single
 *      first-ever transaction — still in the acquisition step)
 *   2. monetary >= highValueMinSpend -> HIGH_VALUE (a huge spender
 *      regardless of frequency/recency — e.g. one large catering event)
 *   3. recency >= inactiveDays     -> INACTIVE (long dormant)
 *   4. recency >= atRiskDays       -> AT_RISK (used to be active, now going
 *      quiet, but not yet fully inactive)
 *   5. frequency >= vipMinTransactions AND monetary >= vipMinSpend -> VIP
 *      (frequent AND high-spend — both axes, unlike HIGH_VALUE's spend-only)
 *   6. frequency >= regularMinTransactions -> REGULAR (frequent, active,
 *      not necessarily high-spend)
 *   7. otherwise                   -> RETURNING (2+ transactions, recently
 *      active, hasn't reached REGULAR's frequency yet)
 */
export function classifySegment(
  metrics: RfmMetrics,
  thresholds: RfmThresholds = DEFAULT_RFM_THRESHOLDS,
): CustomerSegment {
  const monetary = new Prisma.Decimal(metrics.monetary || '0');

  if (metrics.frequency <= 1) return 'NEW';
  if (monetary.gte(new Prisma.Decimal(thresholds.highValueMinSpend))) return 'HIGH_VALUE';
  if (metrics.recencyDays !== null && metrics.recencyDays >= thresholds.inactiveDays) return 'INACTIVE';
  if (metrics.recencyDays !== null && metrics.recencyDays >= thresholds.atRiskDays) return 'AT_RISK';
  if (
    metrics.frequency >= thresholds.vipMinTransactions &&
    monetary.gte(new Prisma.Decimal(thresholds.vipMinSpend))
  ) {
    return 'VIP';
  }
  if (metrics.frequency >= thresholds.regularMinTransactions) return 'REGULAR';
  return 'RETURNING';
}
