import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError } from '@/lib/utils/api-error';
import { ReportingService } from '@/services/reporting/ReportingService';
import { previousPeriod, percentChange } from '@/services/analytics/AnalyticsService';
import {
  salesTrendTool,
  profitAndMarginTool,
  customerBehaviorTool,
  productPerformanceTool,
  channelAndDemandTool,
  inventoryTrendTool,
} from '@/lib/ai/tools';
import { resolveAiInsightThresholds, type AiInsightThresholds } from '@/lib/ai/thresholds';
import { getAIProvider } from '@/lib/ai/AIProvider';
import type { AiInsightsQueryInput, AiForecastQueryInput } from '@/lib/validation/ai';

/**
 * Phase 13 — AI Business Intelligence (master spec's "PHASE 13 — AI" build
 * list: AI analytics service, read-only business data tools, insight
 * generation, trend analysis, forecasting where appropriate).
 *
 * This is the "AI analytics service" itself. It is a deterministic,
 * template-based rule engine, not a call to an external language model —
 * a deliberate reading of §38/§39:
 *   - §38 ("AI responses must always identify the underlying data used" /
 *     "Never allow AI to fabricate financial figures") and its own worked
 *     example ("Delivery revenue increased 18%. Delivery-related costs
 *     increased 26%. Management should investigate: ...") are both fully
 *     satisfiable by a rule engine that only ever emits numbers it just
 *     computed from lib/ai/tools.ts — no generative model is required to
 *     produce that example, and using one would only add a hallucination
 *     risk §39 explicitly warns against.
 *   - §39 requires the AI layer to "read verified data through controlled
 *     server-side tools/services" and never be given unrestricted database
 *     access — every rule function below receives only the already-typed,
 *     already-verified return values of lib/ai/tools.ts's tool calls; none
 *     of them (or this class) ever imports `prisma` for anything except
 *     resolving the organization's timezone/currency/threshold overrides
 *     and validating a supplied branchId, exactly like every Phase 12
 *     AnalyticsService method already does.
 *   - §57 ("Configurable AI provider... do not hard-code any specific
 *     provider") is honored by lib/ai/AIProvider.ts's optional narration
 *     seam (see generateInsights below) — a real provider, once
 *     configured, may rephrase these already-computed insights into
 *     prose, but the insights themselves, and every figure in them, exist
 *     and are complete without it.
 *
 * Every rule compares the requested period against the immediately
 * preceding period of equal length (services/analytics/AnalyticsService's
 * own `previousPeriod` helper, reused here so "previous period" means the
 * same thing in Analytics and in AI Insights), and only surfaces an
 * insight when the change crosses a configurable threshold
 * (lib/ai/thresholds.ts) — the master spec's own "All rules must be
 * configurable" instruction (§37, immediately preceding §38).
 */

export type InsightCategory = 'SALES' | 'MARGIN' | 'EXPENSE' | 'CUSTOMER' | 'PRODUCT' | 'INVENTORY' | 'DEMAND';
export type InsightSeverity = 'ATTENTION' | 'OPPORTUNITY' | 'INFO';

export interface InsightMetric {
  label: string;
  /** Already-formatted, already-computed value — never re-derived by a caller. */
  value: string;
  previousValue?: string;
  /** Percent change current-vs-previous, when that comparison is meaningful (null when there's no baseline, e.g. previous period was zero). */
  percentChange?: number | null;
}

export interface Insight {
  /** Stable within one generateInsights response — not a database id, and not stable across requests. */
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  summary: string;
  recommendations: string[];
  metrics: InsightMetric[];
  /** Which lib/ai/tools.ts tool(s) — and, transitively, which AnalyticsService/ReportingService call(s) — this insight's figures came from. Master spec §38: "AI responses must always identify the underlying data used." */
  dataSources: string[];
}

const ZERO = new Prisma.Decimal(0);

function formatMoney(amount: Prisma.Decimal | number | string, currency: string): string {
  const n = new Prisma.Decimal(amount).toNumber();
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(pct: number | null): string {
  if (pct === null) return 'n/a';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function marginPct(revenue: Prisma.Decimal, amount: Prisma.Decimal): number | null {
  if (revenue.isZero()) return null;
  return amount.dividedBy(revenue).times(100).toDecimalPlaces(1).toNumber();
}

function collectAccounts(statement: Awaited<ReturnType<typeof ReportingService.generateIncomeStatement>>) {
  return [...statement.cogs.accounts, ...statement.operatingExpenses.accounts];
}

// ===========================================================================
// Rule: Sales trend
// ===========================================================================

function buildSalesTrendInsight(
  current: Awaited<ReturnType<typeof salesTrendTool.run>>['data'],
  thresholds: AiInsightThresholds,
  currency: string,
  source: string,
): Insight | null {
  const pct = current.percentChangeVsPreviousPeriod;
  if (pct === null || Math.abs(pct) < thresholds.salesChangePct) return null;
  const growing = pct > 0;
  return {
    id: 'sales-trend',
    category: 'SALES',
    severity: growing ? 'OPPORTUNITY' : 'ATTENTION',
    title: `Revenue ${growing ? 'up' : 'down'} ${formatPct(pct)} vs. the previous period`,
    summary: `Total revenue was ${formatMoney(current.totalRevenue, currency)} this period, versus ${formatMoney(current.previousPeriod.totalRevenue, currency)} in the prior period of equal length — a change of ${formatPct(pct)}.`,
    recommendations: growing
      ? ['Confirm inventory and staffing can sustain the higher order volume.']
      : [
          'Review order volume and average order value for likely drivers.',
          'Check for unusually low delivery/catering activity or cancelled orders in this period.',
        ],
    metrics: [
      {
        label: 'Total revenue',
        value: formatMoney(current.totalRevenue, currency),
        previousValue: formatMoney(current.previousPeriod.totalRevenue, currency),
        percentChange: pct,
      },
    ],
    dataSources: [source],
  };
}

// ===========================================================================
// Rule: Margin change
// ===========================================================================

function buildMarginInsight(
  current: Awaited<ReturnType<typeof profitAndMarginTool.run>>['data'],
  previous: Awaited<ReturnType<typeof profitAndMarginTool.run>>['data'],
  thresholds: AiInsightThresholds,
  source: string,
): Insight | null {
  const currentGross = marginPct(current.totals.revenue.total, current.totals.grossProfit);
  const previousGross = marginPct(previous.totals.revenue.total, previous.totals.grossProfit);
  const currentNet = marginPct(current.totals.revenue.total, current.totals.netProfit);
  const previousNet = marginPct(previous.totals.revenue.total, previous.totals.netProfit);
  if (currentGross === null || previousGross === null || currentNet === null || previousNet === null) return null;

  const grossDiff = Math.round((currentGross - previousGross) * 10) / 10;
  const netDiff = Math.round((currentNet - previousNet) * 10) / 10;
  if (Math.abs(grossDiff) < thresholds.marginChangePoints && Math.abs(netDiff) < thresholds.marginChangePoints) {
    return null;
  }

  const worsening = netDiff < 0 || (netDiff === 0 && grossDiff < 0);
  return {
    id: 'margin-change',
    category: 'MARGIN',
    severity: worsening ? 'ATTENTION' : 'OPPORTUNITY',
    title: `Net margin ${netDiff >= 0 ? 'up' : 'down'} ${Math.abs(netDiff).toFixed(1)} points vs. the previous period`,
    summary: `Gross margin moved from ${previousGross.toFixed(1)}% to ${currentGross.toFixed(1)}%, and net margin moved from ${previousNet.toFixed(1)}% to ${currentNet.toFixed(1)}% — both computed from the posted ledger (ReportingService.generateIncomeStatement).`,
    recommendations: worsening
      ? [
          'Compare COGS and operating expense growth against revenue growth to find the driver.',
          'Review the expense-trend insights below for the specific accounts driving the change.',
        ]
      : ['Confirm the improvement reflects durable pricing/cost discipline rather than a one-off period.'],
    metrics: [
      { label: 'Gross margin', value: `${currentGross.toFixed(1)}%`, previousValue: `${previousGross.toFixed(1)}%` },
      { label: 'Net margin', value: `${currentNet.toFixed(1)}%`, previousValue: `${previousNet.toFixed(1)}%` },
    ],
    dataSources: [source],
  };
}

// ===========================================================================
// Rule: Expense trend (per ledger account)
// ===========================================================================

function buildExpenseTrendInsights(
  current: Awaited<ReturnType<typeof profitAndMarginTool.run>>['data'],
  previous: Awaited<ReturnType<typeof profitAndMarginTool.run>>['data'],
  thresholds: AiInsightThresholds,
  currency: string,
  source: string,
): Insight[] {
  const currentAccounts = collectAccounts(current.totals);
  const previousAccounts = collectAccounts(previous.totals);
  const previousByCode = new Map<string, Prisma.Decimal>();
  for (const a of previousAccounts) previousByCode.set(a.code, a.amount);

  const minAmount = new Prisma.Decimal(thresholds.expenseMinAmount);
  const insights: Insight[] = [];
  for (const account of currentAccounts) {
    if (account.amount.lt(minAmount)) continue;
    const previousAmount = previousByCode.get(account.code) ?? ZERO;
    const isNew = previousAmount.isZero() && account.amount.gt(ZERO);
    const pct = isNew ? null : percentChange(account.amount, previousAmount);
    if (!isNew && (pct === null || Math.abs(pct) < thresholds.expenseChangePct)) continue;

    const kindLabel = account.type === 'COGS' ? 'cost' : 'expense';
    const increased = isNew || (pct !== null && pct > 0);
    insights.push({
      id: `expense-trend-${account.code}`,
      category: 'EXPENSE',
      severity: increased ? 'ATTENTION' : 'OPPORTUNITY',
      title: isNew
        ? `New ${kindLabel}: ${account.name}`
        : `${account.name} ${increased ? 'up' : 'down'} ${formatPct(pct)} vs. the previous period`,
      summary: isNew
        ? `${account.name} recorded ${formatMoney(account.amount, currency)} this period with no comparable amount in the previous period.`
        : `${account.name} was ${formatMoney(account.amount, currency)} this period, versus ${formatMoney(previousAmount, currency)} in the prior period — a change of ${formatPct(pct)}.`,
      recommendations: increased
        ? [`Review recent ${account.name} transactions for the driver of this change.`]
        : [`Confirm the ${account.name} reduction reflects a durable efficiency, not a gap in postings.`],
      metrics: [
        { label: account.name, value: formatMoney(account.amount, currency), previousValue: formatMoney(previousAmount, currency), percentChange: pct },
      ],
      dataSources: [source],
    });
  }
  return insights;
}

// ===========================================================================
// Rule: Channel cost-vs-revenue divergence — the master spec §38 worked
// example ("Delivery revenue increased 18%. Delivery-related costs
// increased 26%.") made concrete for the two channels the seeded chart of
// accounts gives a dedicated COGS account (Delivery Cost, Catering Cost).
// ===========================================================================

const CHANNEL_COST_ACCOUNTS: ReadonlyArray<{
  channelLabel: string;
  costAccountCode: string;
  costAccountName: string;
  getRevenue: (channel: Awaited<ReturnType<typeof channelAndDemandTool.run>>['data']) => Prisma.Decimal;
}> = [
  {
    channelLabel: 'Delivery',
    costAccountCode: '5040',
    costAccountName: 'Delivery Cost',
    getRevenue: (c) => c.byType.find((t) => t.type === 'DELIVERY')?.revenue ?? ZERO,
  },
  {
    channelLabel: 'Catering',
    costAccountCode: '5030',
    costAccountName: 'Catering Cost',
    getRevenue: (c) => c.catering.revenue,
  },
];

function buildChannelDivergenceInsights(
  currentChannel: Awaited<ReturnType<typeof channelAndDemandTool.run>>['data'],
  previousChannel: Awaited<ReturnType<typeof channelAndDemandTool.run>>['data'],
  currentProfit: Awaited<ReturnType<typeof profitAndMarginTool.run>>['data'],
  previousProfit: Awaited<ReturnType<typeof profitAndMarginTool.run>>['data'],
  thresholds: AiInsightThresholds,
  currency: string,
  channelSource: string,
  profitSource: string,
): Insight[] {
  const currentAccounts = collectAccounts(currentProfit.totals);
  const previousAccounts = collectAccounts(previousProfit.totals);
  const minAmount = new Prisma.Decimal(thresholds.expenseMinAmount);

  const insights: Insight[] = [];
  for (const def of CHANNEL_COST_ACCOUNTS) {
    const costCurrent = currentAccounts.find((a) => a.code === def.costAccountCode)?.amount ?? ZERO;
    if (costCurrent.lt(minAmount)) continue;
    const costPrevious = previousAccounts.find((a) => a.code === def.costAccountCode)?.amount ?? ZERO;
    const revenueCurrent = def.getRevenue(currentChannel);
    const revenuePrevious = def.getRevenue(previousChannel);

    const revenuePct = percentChange(revenueCurrent, revenuePrevious);
    const costPct = percentChange(costCurrent, costPrevious);
    if (revenuePct === null || costPct === null) continue;
    const divergence = Math.round((costPct - revenuePct) * 10) / 10;
    if (divergence < thresholds.channelCostDivergencePoints) continue;

    const changeWord = (pct: number) => (pct >= 0 ? 'increased' : 'decreased');
    insights.push({
      id: `channel-divergence-${def.channelLabel.toLowerCase()}`,
      category: 'EXPENSE',
      severity: 'ATTENTION',
      title: `${def.channelLabel} costs are outpacing ${def.channelLabel.toLowerCase()} revenue`,
      summary: `${def.channelLabel} revenue ${changeWord(revenuePct)} ${Math.abs(revenuePct)}%. ${def.costAccountName} ${changeWord(costPct)} ${Math.abs(costPct)}%.`,
      recommendations: [
        `Review ${def.channelLabel.toLowerCase()} fees and pricing.`,
        'Review packaging cost per order.',
        'Review driver/rider or vendor cost per order.',
        `Review ${def.channelLabel.toLowerCase()} zone or service-area boundaries and distance-based costs.`,
      ],
      metrics: [
        { label: `${def.channelLabel} revenue`, value: formatMoney(revenueCurrent, currency), previousValue: formatMoney(revenuePrevious, currency), percentChange: revenuePct },
        { label: def.costAccountName, value: formatMoney(costCurrent, currency), previousValue: formatMoney(costPrevious, currency), percentChange: costPct },
      ],
      dataSources: [channelSource, profitSource],
    });
  }
  return insights;
}

// ===========================================================================
// Rule: Customer behavior
// ===========================================================================

function buildCustomerInsight(
  current: Awaited<ReturnType<typeof customerBehaviorTool.run>>['data'],
  previous: Awaited<ReturnType<typeof customerBehaviorTool.run>>['data'],
  thresholds: AiInsightThresholds,
  source: string,
): Insight | null {
  const diff = Math.round((current.repeatRate - previous.repeatRate) * 10) / 10;
  if (Math.abs(diff) < thresholds.repeatRateChangePoints) return null;

  const improving = diff > 0;
  return {
    id: 'customer-repeat-rate',
    category: 'CUSTOMER',
    severity: improving ? 'OPPORTUNITY' : 'ATTENTION',
    title: `Repeat customer rate ${improving ? 'up' : 'down'} ${Math.abs(diff).toFixed(1)} points vs. the previous period`,
    summary: `${current.repeatRate.toFixed(1)}% of customers who ordered this period were repeat customers, versus ${previous.repeatRate.toFixed(1)}% in the prior period. ${current.newCustomers} new customer(s) joined this period (${previous.newCustomers} in the prior period).`,
    recommendations: improving
      ? ['Consider a loyalty or referral program to reinforce the trend.']
      : [
          'Review recent service/quality signals (reviews and notes on Customer Analytics).',
          'Consider a win-back promotion targeted at the AT_RISK/INACTIVE segments.',
        ],
    metrics: [
      { label: 'Repeat rate', value: `${current.repeatRate.toFixed(1)}%`, previousValue: `${previous.repeatRate.toFixed(1)}%` },
      {
        label: 'New customers',
        value: String(current.newCustomers),
        previousValue: String(previous.newCustomers),
        percentChange: percentChange(new Prisma.Decimal(current.newCustomers), new Prisma.Decimal(previous.newCustomers)),
      },
    ],
    dataSources: [source],
  };
}

// ===========================================================================
// Rule: Product performance — by menu category (the full, uncapped set
// AnalyticsService.getProductAnalytics returns), not by individual
// top-10-by-revenue product: a product absent from one period's top 10
// can't be compared to its own prior-period figure, but every category is
// always present, so category-level trend is the robust comparison here.
// ===========================================================================

function buildProductCategoryInsights(
  current: Awaited<ReturnType<typeof productPerformanceTool.run>>['data'],
  previous: Awaited<ReturnType<typeof productPerformanceTool.run>>['data'],
  thresholds: AiInsightThresholds,
  currency: string,
  source: string,
): Insight[] {
  const previousByKey = new Map<string, { revenue: Prisma.Decimal; quantitySold: number }>();
  for (const cat of previous.revenueByCategory) previousByKey.set(cat.categoryId ?? 'uncategorized', cat);

  const minAmount = new Prisma.Decimal(thresholds.expenseMinAmount);
  const insights: Insight[] = [];
  for (const cat of current.revenueByCategory) {
    if (cat.quantitySold < thresholds.minProductOrders) continue;
    if (cat.revenue.lt(minAmount)) continue;
    const key = cat.categoryId ?? 'uncategorized';
    const previousRevenue = previousByKey.get(key)?.revenue ?? ZERO;
    const pct = percentChange(cat.revenue, previousRevenue);
    if (pct === null || Math.abs(pct) < thresholds.productChangePct) continue;

    const growing = pct > 0;
    insights.push({
      id: `product-category-${key}`,
      category: 'PRODUCT',
      severity: growing ? 'OPPORTUNITY' : 'ATTENTION',
      title: `${cat.categoryName} sales ${growing ? 'up' : 'down'} ${formatPct(pct)} vs. the previous period`,
      summary: `${cat.categoryName} generated ${formatMoney(cat.revenue, currency)} this period (${cat.quantitySold} item(s) sold), versus ${formatMoney(previousRevenue, currency)} in the prior period.`,
      recommendations: growing
        ? ['Confirm supply and staffing can sustain the higher demand for this category.']
        : [
            'Review pricing, availability, and marketing for this category.',
            'Check the Inventory Trends insights below for related stockouts.',
          ],
      metrics: [
        { label: `${cat.categoryName} revenue`, value: formatMoney(cat.revenue, currency), previousValue: formatMoney(previousRevenue, currency), percentChange: pct },
      ],
      dataSources: [source],
    });
  }
  return insights;
}

// ===========================================================================
// Rule: Inventory trends — waste cost trend and critical-stock alert
// ===========================================================================

function buildInventoryInsights(
  current: Awaited<ReturnType<typeof inventoryTrendTool.run>>['data'],
  previous: Awaited<ReturnType<typeof inventoryTrendTool.run>>['data'],
  thresholds: AiInsightThresholds,
  currency: string,
  source: string,
): Insight[] {
  const insights: Insight[] = [];

  const wastePct = percentChange(current.wasteCost.total, previous.wasteCost.total);
  if (wastePct !== null && Math.abs(wastePct) >= thresholds.wasteCostChangePct) {
    const increased = wastePct > 0;
    insights.push({
      id: 'inventory-waste-trend',
      category: 'INVENTORY',
      severity: increased ? 'ATTENTION' : 'OPPORTUNITY',
      title: `Waste cost ${increased ? 'up' : 'down'} ${formatPct(wastePct)} vs. the previous period`,
      summary: `Total waste cost was ${formatMoney(current.wasteCost.total, currency)} this period, versus ${formatMoney(previous.wasteCost.total, currency)} in the prior period.`,
      recommendations: increased
        ? [
            'Review the top waste-driving ingredients on the Inventory Analytics dashboard.',
            'Check for over-ordering, spoilage, or portioning issues.',
          ]
        : ['Confirm the reduction reflects durable process improvements.'],
      metrics: [
        { label: 'Waste cost', value: formatMoney(current.wasteCost.total, currency), previousValue: formatMoney(previous.wasteCost.total, currency), percentChange: wastePct },
      ],
      dataSources: [source],
    });
  }

  if (current.criticalStockCount >= thresholds.criticalStockCount) {
    insights.push({
      id: 'inventory-critical-stock',
      category: 'INVENTORY',
      severity: 'ATTENTION',
      title: `${current.criticalStockCount} ingredient(s) at critical stock level`,
      summary: `${current.criticalStockCount} ingredient(s) are at or below their critical reorder threshold as of this period (${current.lowStockCount} more at low but non-critical levels).`,
      recommendations: ['Reorder the affected ingredients — see Inventory > Low Stock.'],
      metrics: [
        { label: 'Critical stock items', value: String(current.criticalStockCount) },
        { label: 'Low stock items', value: String(current.lowStockCount) },
      ],
      dataSources: [source],
    });
  }

  return insights;
}

// ===========================================================================
// Rule: Demand patterns — informational, no threshold (there is no
// meaningful "previous period" comparison for an hour/weekday
// distribution the way there is for a single total).
// ===========================================================================

function buildDemandInsight(
  current: Awaited<ReturnType<typeof channelAndDemandTool.run>>['data'],
  source: string,
): Insight | null {
  const totalOrders = current.salesByHour.reduce((sum, h) => sum + h.orderCount, 0);
  if (totalOrders === 0) return null;

  const peakHour = [...current.salesByHour].sort((a, b) => b.revenue.comparedTo(a.revenue))[0];
  const peakWeekday = [...current.salesByDayOfWeek].sort((a, b) => b.revenue.comparedTo(a.revenue))[0];
  if (!peakHour || !peakWeekday) return null;

  const hourLabel = `${String(peakHour.hour).padStart(2, '0')}:00`;
  return {
    id: 'demand-pattern',
    category: 'DEMAND',
    severity: 'INFO',
    title: `Peak demand this period: ${peakWeekday.weekday}s around ${hourLabel}`,
    summary: `${peakWeekday.weekday} was the highest-revenue day of the week, and ${hourLabel} was the highest-revenue hour of the day, across this period.`,
    recommendations: ['Align staffing schedules and prep timing with this peak window.'],
    metrics: [
      { label: 'Peak weekday', value: peakWeekday.weekday },
      { label: 'Peak hour', value: hourLabel },
    ],
    dataSources: [source],
  };
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = { ATTENTION: 0, OPPORTUNITY: 1, INFO: 2 };

export class InsightService {
  private static async resolveOrgAndRange(organizationId: string, query: AiInsightsQueryInput | AiForecastQueryInput) {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, currency: true, timezone: true, aiSettings: true },
    });
    if (query.branchId) {
      const branch = await prisma.branch.findFirst({ where: { id: query.branchId, organizationId } });
      if (!branch) throw new NotFoundError('Branch');
    }
    const range = await ReportingService.resolveReportDateRange(organizationId, query);
    return { org, range };
  }

  /**
   * The "AI analytics service" itself — runs every rule above over the
   * requested period vs. its immediately-preceding period of equal length,
   * and returns the surfaced insights (sorted ATTENTION, then OPPORTUNITY,
   * then INFO — "what requires attention" first, master spec §76's own AI
   * Business Insights framing: "What changed? Why did it change? What
   * requires attention? What opportunity exists?").
   */
  static async generateInsights(organizationId: string, query: AiInsightsQueryInput) {
    const { org, range } = await this.resolveOrgAndRange(organizationId, query);
    const prior = previousPeriod(range.startDate, range.endDate);
    const thresholds = resolveAiInsightThresholds(org.aiSettings);
    const branchId = query.branchId;

    const [
      sales,
      profitCurrent,
      profitPrevious,
      customerCurrent,
      customerPrevious,
      productCurrent,
      productPrevious,
      channelCurrent,
      channelPrevious,
      inventoryCurrent,
      inventoryPrevious,
    ] = await Promise.all([
      salesTrendTool.run(organizationId, range, branchId),
      profitAndMarginTool.run(organizationId, range, branchId),
      profitAndMarginTool.run(organizationId, prior, branchId),
      customerBehaviorTool.run(organizationId, range, branchId),
      customerBehaviorTool.run(organizationId, prior, branchId),
      productPerformanceTool.run(organizationId, range, branchId),
      productPerformanceTool.run(organizationId, prior, branchId),
      channelAndDemandTool.run(organizationId, range, branchId),
      channelAndDemandTool.run(organizationId, prior, branchId),
      inventoryTrendTool.run(organizationId, range, branchId),
      inventoryTrendTool.run(organizationId, prior, branchId),
    ]);

    const insights: Insight[] = [];
    const salesInsight = buildSalesTrendInsight(sales.data, thresholds, org.currency, sales.source);
    if (salesInsight) insights.push(salesInsight);

    const marginInsight = buildMarginInsight(profitCurrent.data, profitPrevious.data, thresholds, profitCurrent.source);
    if (marginInsight) insights.push(marginInsight);

    insights.push(...buildExpenseTrendInsights(profitCurrent.data, profitPrevious.data, thresholds, org.currency, profitCurrent.source));
    insights.push(
      ...buildChannelDivergenceInsights(
        channelCurrent.data,
        channelPrevious.data,
        profitCurrent.data,
        profitPrevious.data,
        thresholds,
        org.currency,
        channelCurrent.source,
        profitCurrent.source,
      ),
    );

    const customerInsight = buildCustomerInsight(customerCurrent.data, customerPrevious.data, thresholds, customerCurrent.source);
    if (customerInsight) insights.push(customerInsight);

    insights.push(...buildProductCategoryInsights(productCurrent.data, productPrevious.data, thresholds, org.currency, productCurrent.source));
    insights.push(...buildInventoryInsights(inventoryCurrent.data, inventoryPrevious.data, thresholds, org.currency, inventoryCurrent.source));

    const demandInsight = buildDemandInsight(channelCurrent.data, channelCurrent.source);
    if (demandInsight) insights.push(demandInsight);

    insights.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    // Optional AI-provider narration — see lib/ai/AIProvider.ts's header
    // for the safety boundary (a provider may only rephrase these
    // already-computed insights; it is never handed a database connection
    // or asked to supply a new figure). No provider is configured in this
    // codebase yet (getAIProvider always returns UnconfiguredAIProvider),
    // so this always falls back to narrativeStatus 'not_configured' today
    // — the deterministic insights above are the complete feature either
    // way. Wiring a real provider in later requires no InsightService
    // change beyond lib/ai/AIProvider.ts's own factory.
    const provider = getAIProvider();
    let narrative: string | null = null;
    let narrativeStatus: 'not_configured' | 'generated' | 'failed' = 'not_configured';
    if (provider.name !== 'unconfigured') {
      try {
        const result = await provider.narrate({
          insights: insights.map((i) => ({
            category: i.category,
            severity: i.severity,
            title: i.title,
            summary: i.summary,
            recommendations: i.recommendations,
            metrics: i.metrics,
          })),
          context: {
            organizationName: org.name,
            currency: org.currency,
            periodLabel: `${range.startDate.toISOString().slice(0, 10)} to ${range.endDate.toISOString().slice(0, 10)}`,
          },
        });
        narrative = result.narrative;
        narrativeStatus = 'generated';
      } catch {
        narrativeStatus = 'failed';
      }
    }

    return {
      startDate: range.startDate,
      endDate: range.endDate,
      branchId: branchId ?? null,
      generatedAt: new Date(),
      insights,
      narrative,
      narrativeStatus,
    };
  }

  /**
   * "Forecasting where appropriate" (master spec §37's Phase 13 build
   * list) — a naive least-squares linear regression over the selected
   * period's own revenue trend buckets (lib/ai/tools.ts's salesTrendTool),
   * projected `periodsAhead` buckets forward. This is a documented
   * heuristic, not a machine-learning model or a call to any external
   * service — every input is a real, already-verified revenue figure, and
   * the method is fully disclosed in the response rather than presented as
   * an authoritative prediction (master spec §39: the AI layer is an
   * analytical assistant, never the source of financial truth).
   *
   * Deliberately revenue-only: compounding a second, independently-noisy
   * series (e.g. projecting margin or profit) on top of a already-noisy
   * linear projection would read as a financial promise this codebase has
   * no basis to make — see this file's header on §39. Requires at least 3
   * historical buckets; returns `status: 'insufficient_data'` otherwise
   * rather than projecting from too little history to mean anything.
   */
  static async forecastRevenue(organizationId: string, query: AiForecastQueryInput) {
    const { range } = await this.resolveOrgAndRange(organizationId, query);
    const sales = await salesTrendTool.run(organizationId, range, query.branchId);
    const history = sales.data.trend;
    const granularity = sales.data.granularity;

    const MIN_BUCKETS = 3;
    if (history.length < MIN_BUCKETS) {
      return {
        status: 'insufficient_data' as const,
        startDate: range.startDate,
        endDate: range.endDate,
        branchId: query.branchId ?? null,
        granularity,
        history,
        forecast: [] as Array<{ bucket: string; projectedRevenue: string }>,
        method: null,
        disclaimer: `At least ${MIN_BUCKETS} ${granularity} buckets of history are needed to forecast; this period has ${history.length}. Widen the date range and try again.`,
        dataSources: [sales.source],
      };
    }

    // Least-squares linear regression over (bucket index, revenue). Points
    // are zipped rather than indexed (`history[i]`) so this doesn't need a
    // non-null assertion under this project's noUncheckedIndexedAccess —
    // same reasoning CLAUDE.md's Known Issues already documents for why
    // this codebase avoids raw array indexing in loops.
    const points = history.map((h, i) => ({ x: i, y: h.revenue.toNumber() }));
    const n = points.length;
    const meanX = points.reduce((s, p) => s + p.x, 0) / n;
    const meanY = points.reduce((s, p) => s + p.y, 0) / n;
    let numerator = 0;
    let denominator = 0;
    for (const p of points) {
      numerator += (p.x - meanX) * (p.y - meanY);
      denominator += (p.x - meanX) ** 2;
    }
    const slope = denominator === 0 ? 0 : numerator / denominator;
    const intercept = meanY - slope * meanX;

    const forecast = Array.from({ length: query.periodsAhead }, (_, k) => {
      const x = n + k;
      const projected = Math.max(0, slope * x + intercept);
      return { bucket: `projected_${k + 1}`, projectedRevenue: projected.toFixed(2) };
    });

    return {
      status: 'ok' as const,
      startDate: range.startDate,
      endDate: range.endDate,
      branchId: query.branchId ?? null,
      granularity,
      history,
      forecast,
      method: 'linear-regression-over-trailing-buckets',
      disclaimer:
        "Naive linear projection over this period's own trend buckets. Not a guarantee; accuracy degrades quickly beyond the first projected bucket, and the model has no awareness of seasonality, holidays, or planned promotions.",
      dataSources: [sales.source],
    };
  }
}
