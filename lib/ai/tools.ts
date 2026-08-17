import 'server-only';
import { AnalyticsService } from '@/services/analytics/AnalyticsService';

/**
 * Phase 13 — AI Business Intelligence. Master spec §39 ("AI SAFETY RULE")
 * diagrams the only path data may reach the AI layer through:
 *
 *   AI
 *   ↓
 *   Read-only analytics tools
 *   ↓
 *   Verified database queries
 *   ↓
 *   Business data
 *
 * This file IS that middle layer — "Read-only business data tools" is also
 * its own named deliverable in the master spec's Phase 13 build list,
 * distinct from "AI analytics service" (services/ai/InsightService.ts).
 * Every tool here is a thin, read-only wrapper around a Phase 12
 * AnalyticsService method (already itself read-only, live-computed, and
 * either operational-table- or ledger-sourced — see that file's own header
 * for the data-sourcing split). Nothing in this file writes to the
 * database, and nothing in it accepts a raw Prisma query from a caller —
 * only an organization id, a resolved date range, and an optional branch
 * filter, exactly like every AnalyticsService method already requires.
 *
 * The `name`/`description` shape on each tool is deliberately the same
 * shape a real LLM function-calling integration would bind to (tool name +
 * description + typed handler) — see lib/ai/AIProvider.ts's header for why
 * no such integration exists yet. Today, services/ai/InsightService.ts is
 * the only caller, invoking these directly rather than through a model's
 * tool-choice loop; the registry exists so that seam is already in place
 * when a real provider is wired in, without changing what data it's
 * allowed to touch.
 */

export interface AiDateRange {
  startDate: Date;
  endDate: Date;
}

export interface AiToolResult<T> {
  data: T;
  /** Identifies exactly which verified service call produced `data` — surfaced on every Insight's dataSources (master spec §38: "AI responses must always identify the underlying data used"). */
  source: string;
}

export interface AiTool<T> {
  name: string;
  description: string;
  run(organizationId: string, range: AiDateRange, branchId?: string): Promise<AiToolResult<T>>;
}

/** Builds the `{preset: 'custom', startDate, endDate, branchId}` query AnalyticsService's methods expect for an arbitrary, already-resolved date range (e.g. an insight's "previous period" comparison window, which is never itself one of the named presets). */
function customRangeQuery(range: AiDateRange, branchId?: string) {
  return {
    preset: 'custom' as const,
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    branchId,
  };
}

export const salesTrendTool: AiTool<Awaited<ReturnType<typeof AnalyticsService.getRevenueDashboard>>> = {
  name: 'get_sales_trend',
  description: 'Revenue trend (orders + settled catering balances), bucketed, with period-over-period comparison.',
  async run(organizationId, range, branchId) {
    const data = await AnalyticsService.getRevenueDashboard(organizationId, customRangeQuery(range, branchId));
    return { data, source: 'AnalyticsService.getRevenueDashboard' };
  },
};

export const profitAndMarginTool: AiTool<Awaited<ReturnType<typeof AnalyticsService.getProfitDashboard>>> = {
  name: 'get_profit_and_margin',
  description: 'Revenue/COGS/gross profit/operating expenses/net profit for the period, sourced from the posted ledger — including a per-account breakdown usable for expense-trend comparisons.',
  async run(organizationId, range, branchId) {
    const data = await AnalyticsService.getProfitDashboard(organizationId, customRangeQuery(range, branchId));
    return { data, source: 'AnalyticsService.getProfitDashboard (ledger via ReportingService.generateIncomeStatement)' };
  },
};

export const customerBehaviorTool: AiTool<Awaited<ReturnType<typeof AnalyticsService.getCustomerAnalytics>>> = {
  name: 'get_customer_behavior',
  description: 'New/repeat customer counts, repeat rate, top spenders, and RFM segment mix.',
  async run(organizationId, range, branchId) {
    const data = await AnalyticsService.getCustomerAnalytics(organizationId, customRangeQuery(range, branchId));
    return { data, source: 'AnalyticsService.getCustomerAnalytics' };
  },
};

export const productPerformanceTool: AiTool<Awaited<ReturnType<typeof AnalyticsService.getProductAnalytics>>> = {
  name: 'get_product_performance',
  description: 'Top products by revenue and quantity, and revenue by menu category.',
  async run(organizationId, range, branchId) {
    const data = await AnalyticsService.getProductAnalytics(organizationId, customRangeQuery(range, branchId));
    return { data, source: 'AnalyticsService.getProductAnalytics' };
  },
};

export const channelAndDemandTool: AiTool<Awaited<ReturnType<typeof AnalyticsService.getChannelAnalytics>>> = {
  name: 'get_channel_and_demand',
  description: 'Revenue by order channel and catering, plus sales-by-hour and sales-by-weekday demand distribution.',
  async run(organizationId, range, branchId) {
    const data = await AnalyticsService.getChannelAnalytics(organizationId, customRangeQuery(range, branchId));
    return { data, source: 'AnalyticsService.getChannelAnalytics' };
  },
};

export const inventoryTrendTool: AiTool<Awaited<ReturnType<typeof AnalyticsService.getInventoryAnalytics>>> = {
  name: 'get_inventory_trend',
  description: 'Waste cost by ingredient, purchase spend, recognized food cost, and low/critical stock counts.',
  async run(organizationId, range, branchId) {
    const data = await AnalyticsService.getInventoryAnalytics(organizationId, customRangeQuery(range, branchId));
    return { data, source: 'AnalyticsService.getInventoryAnalytics' };
  },
};

export const operationalMetricsTool: AiTool<Awaited<ReturnType<typeof AnalyticsService.getOperationalAnalytics>>> = {
  name: 'get_operational_metrics',
  description: 'Reservation/catering/delivery status funnels, table utilization, and kitchen prep-to-ready time.',
  async run(organizationId, range, branchId) {
    const data = await AnalyticsService.getOperationalAnalytics(organizationId, customRangeQuery(range, branchId));
    return { data, source: 'AnalyticsService.getOperationalAnalytics' };
  },
};

/**
 * Every read-only AI tool, keyed by name — one per Phase 12 AnalyticsService
 * dashboard, covering every "AI can analyze" category the master spec's
 * §38 lists (sales trends, customer behavior, product performance,
 * inventory trends, expense trends, margin changes, demand patterns).
 *
 * Keyed with explicit literal keys rather than computed `[tool.name]`
 * entries on purpose: a computed property keyed by a plain `string`-typed
 * expression (AiTool.name is typed `string`, not a literal) would collapse
 * this object's inferred type down to a generic string index signature
 * instead of seven precisely-typed properties — the same class of TS
 * inference gap CLAUDE.md's Known Issues already documents twice over
 * (dashboard-nav.tsx's `as const` narrowing, AnalyticsService's
 * `new Map(x.map(...))`). Each key below is written out to match its
 * tool's own `name` field exactly; that pairing has no compiler
 * enforcement, so keep them in sync by hand if a tool is renamed.
 */
export const AI_TOOLS = {
  get_sales_trend: salesTrendTool,
  get_profit_and_margin: profitAndMarginTool,
  get_customer_behavior: customerBehaviorTool,
  get_product_performance: productPerformanceTool,
  get_channel_and_demand: channelAndDemandTool,
  get_inventory_trend: inventoryTrendTool,
  get_operational_metrics: operationalMetricsTool,
} as const;
