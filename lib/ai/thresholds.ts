/**
 * Phase 13 — AI Business Intelligence. Master spec §37 closes its expense/
 * waste-increase rule list with "All rules must be configurable" — the same
 * instruction §32 gave for CRM's RFM segmentation, which lib/crm/rfm.ts
 * already answers with a "DEFAULT_* constant + per-organization JSON
 * override" pattern. This file is that same pattern applied to the
 * insight-generation engine's own thresholds: how big a swing in revenue,
 * margin, an individual expense/COGS account, waste cost, or repeat rate
 * has to be before InsightService surfaces it as something worth a manager's
 * attention, rather than normal period-to-period noise.
 *
 * These are display/attention thresholds only — they decide whether a
 * computed, real percent-change gets surfaced as an Insight, never how that
 * percent-change itself is computed (that's AnalyticsService.percentChange,
 * reused as-is by lib/ai/tools.ts). Loosening a threshold surfaces more
 * insights over the same real numbers; it can never change what those
 * numbers are.
 */

export interface AiInsightThresholds {
  /** Minimum |percent change| in total revenue vs. the previous period to surface a sales-trend insight. */
  salesChangePct: number;
  /** Minimum |percentage-point change| in gross or net margin vs. the previous period to surface a margin insight. */
  marginChangePoints: number;
  /** Minimum |percent change| in an individual expense/COGS account's amount vs. the previous period to surface an expense-trend insight for that account. */
  expenseChangePct: number;
  /** Minimum absolute amount (decimal string, org currency) an expense/COGS account must reach in the current period before its percent change is even considered — keeps a tiny account's noisy percent swings out of the feed. */
  expenseMinAmount: string;
  /** Minimum percentage-point gap by which a channel's linked COGS account (e.g. Delivery Cost) growth rate must exceed that channel's own revenue growth rate to surface a cost-vs-revenue divergence insight — the master spec §38 worked example (delivery revenue +18%, delivery cost +26%). */
  channelCostDivergencePoints: number;
  /** Minimum |percentage-point change| in customer repeat rate vs. the previous period to surface a customer-behavior insight. */
  repeatRateChangePoints: number;
  /** Minimum |percent change| in total waste cost vs. the previous period to surface an inventory-waste insight. */
  wasteCostChangePct: number;
  /** Minimum count of CRITICAL-level low-stock items to surface an inventory-attention insight. */
  criticalStockCount: number;
  /** Minimum |percent change| in a single product's revenue vs. the previous period (products with at least minProductOrders orders in both periods) to surface a product-performance insight. */
  productChangePct: number;
  /** Minimum order/line count a product must have in the current period before its percent change is considered — keeps a single one-off order from reading as a "300% increase". */
  minProductOrders: number;
}

/**
 * Sane defaults for a mid-size PH restaurant — deliberately conservative
 * starting points, not a claim about what "significant" universally means
 * (same caveat lib/crm/rfm.ts's DEFAULT_RFM_THRESHOLDS states for its own
 * defaults). See resolveAiInsightThresholds below for the per-organization
 * override mechanism (Organization.aiSettings).
 */
export const DEFAULT_AI_INSIGHT_THRESHOLDS: AiInsightThresholds = {
  salesChangePct: 10,
  marginChangePoints: 3,
  expenseChangePct: 15,
  expenseMinAmount: '1000.00',
  channelCostDivergencePoints: 5,
  repeatRateChangePoints: 5,
  wasteCostChangePct: 20,
  criticalStockCount: 1,
  productChangePct: 25,
  minProductOrders: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges Organization.aiSettings.insightThresholds (arbitrary JSON from the
 * DB) over DEFAULT_AI_INSIGHT_THRESHOLDS, field by field, with defensive
 * validation — a malformed or missing override for one field silently
 * falls back to that field's default rather than throwing or corrupting
 * the whole threshold set. Mirrors lib/crm/rfm.ts's resolveRfmThresholds
 * exactly, including why: an indexed/looped merge across a threshold type
 * with mixed number/string fields doesn't type-check soundly without an
 * `as any` escape hatch, so this is written as explicit per-field
 * assignments instead. Accepts the raw aiSettings JSON value (or
 * null/undefined) directly, so callers don't need to know its shape ahead
 * of time.
 */
export function resolveAiInsightThresholds(aiSettings: unknown): AiInsightThresholds {
  const overrides =
    isRecord(aiSettings) && isRecord(aiSettings.insightThresholds) ? aiSettings.insightThresholds : {};

  const numericOverride = (key: keyof AiInsightThresholds, current: number): number => {
    const value = overrides[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : current;
  };
  const moneyOverride = (key: keyof AiInsightThresholds, current: string): string => {
    const value = overrides[key];
    return typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value) ? value : current;
  };

  return {
    salesChangePct: numericOverride('salesChangePct', DEFAULT_AI_INSIGHT_THRESHOLDS.salesChangePct),
    marginChangePoints: numericOverride('marginChangePoints', DEFAULT_AI_INSIGHT_THRESHOLDS.marginChangePoints),
    expenseChangePct: numericOverride('expenseChangePct', DEFAULT_AI_INSIGHT_THRESHOLDS.expenseChangePct),
    expenseMinAmount: moneyOverride('expenseMinAmount', DEFAULT_AI_INSIGHT_THRESHOLDS.expenseMinAmount),
    channelCostDivergencePoints: numericOverride('channelCostDivergencePoints', DEFAULT_AI_INSIGHT_THRESHOLDS.channelCostDivergencePoints),
    repeatRateChangePoints: numericOverride('repeatRateChangePoints', DEFAULT_AI_INSIGHT_THRESHOLDS.repeatRateChangePoints),
    wasteCostChangePct: numericOverride('wasteCostChangePct', DEFAULT_AI_INSIGHT_THRESHOLDS.wasteCostChangePct),
    criticalStockCount: numericOverride('criticalStockCount', DEFAULT_AI_INSIGHT_THRESHOLDS.criticalStockCount),
    productChangePct: numericOverride('productChangePct', DEFAULT_AI_INSIGHT_THRESHOLDS.productChangePct),
    minProductOrders: numericOverride('minProductOrders', DEFAULT_AI_INSIGHT_THRESHOLDS.minProductOrders),
  };
}
