import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError } from '@/lib/utils/api-error';
import {
  dateKeyInTimezone,
  startOfDayInTimezone,
  startOfWeekInTimezone,
  startOfMonthInTimezone,
  endOfMonthInTimezone,
} from '@/lib/utils/timezone';
import { ReportingService } from '@/services/reporting/ReportingService';
import { CustomerService } from '@/services/crm/CustomerService';
import { InventoryService } from '@/services/inventory/InventoryService';
import type { ReportDateRangeQueryInput } from '@/lib/validation/reporting';

/**
 * Phase 12 — Owner Analytics (master spec's "PHASE 12 — OWNER ANALYTICS"
 * build list: Revenue dashboard, Profit dashboard, Customer analytics,
 * Product analytics, Channel analytics, Inventory analytics, Operational
 * analytics), plus the §76 "Final Owner Experience" mock's SALES/CUSTOMERS/
 * OPERATIONS/INVENTORY sections that this phase's dashboards are meant to
 * back with real numbers (FINANCE was already covered by Phase 11).
 *
 * Data-sourcing split (communicated to the user at kickoff): six of these
 * seven methods read directly from the operational tables (Order,
 * Reservation, CateringEvent/Payment, Customer, WasteRecord, ...) — the
 * same "live-computed, never a stale aggregate" convention CustomerService
 * and InventoryService already use. `getProfitDashboard` is the one
 * exception: profit requires real COGS/expense figures that only exist on
 * the posted ledger, so it's the only method here that calls into
 * ReportingService rather than reading Order/OrderItem directly — this
 * keeps "profit" in Analytics consistent with "profit" in Finance by
 * construction, never a second, potentially-divergent calculation.
 *
 * Every method takes the same `{ preset, startDate, endDate, branchId }`
 * query shape (lib/validation/analytics.ts, re-exporting
 * reportDateRangeQuerySchema from Phase 11) and resolves it the same way
 * ReportingService's routes already do, via `resolveReportDateRange` —
 * "today"/"this month"/etc. mean the same thing everywhere in this app.
 *
 * Catering revenue recognition, here and throughout: a catering event's
 * revenue is attributed to the date its BALANCE `CateringPayment` posts
 * (status COMPLETED), matching exactly when AccountingService.
 * recordCateringBalanceSettled posts it to the ledger's Catering Revenue
 * account (see that method's doc comment) — not the (usually earlier)
 * inquiry/quote/deposit dates, and not `CateringEvent.eventDate`, which can
 * fall outside the payment's own period. This is a deliberate choice to
 * keep the operational-side "when did catering revenue happen" answer
 * consistent with the ledger's own, even though this file otherwise never
 * reads the ledger directly.
 */

const ZERO = new Prisma.Decimal(0);
type Granularity = 'day' | 'week' | 'month';

function sumDecimal(values: ReadonlyArray<Prisma.Decimal | number | string>): Prisma.Decimal {
  return values.reduce((sum: Prisma.Decimal, v) => sum.plus(v), ZERO);
}

/** Percent change from `previous` to `current`, or null when there's no meaningful baseline (previous period had nothing). */
function percentChange(current: Prisma.Decimal, previous: Prisma.Decimal): number | null {
  if (previous.isZero()) return null;
  return current.minus(previous).dividedBy(previous).times(100).toDecimalPlaces(1).toNumber();
}

/** The immediately-preceding period of the same length as [startDate, endDate] — used by every dashboard's "vs. last period" comparison. */
function previousPeriod(startDate: Date, endDate: Date): { startDate: Date; endDate: Date } {
  const durationMs = endDate.getTime() - startDate.getTime() + 1;
  const prevEnd = new Date(startDate.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs + 1);
  return { startDate: prevStart, endDate: prevEnd };
}

/**
 * Day buckets for a range up to ~31 days (fine trend detail on a short
 * window), week buckets up to ~120 days, month buckets beyond that — the
 * same "don't render 366 daily points on a This Year chart" reasoning any
 * dashboard needs; the exact cutoffs aren't spec'd, so these are a
 * documented, sensible default rather than a spec'd figure.
 */
function chooseGranularity(startDate: Date, endDate: Date): Granularity {
  const days = (endDate.getTime() - startDate.getTime()) / 86_400_000;
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

/** The bucket key a given instant falls into at the given granularity — "YYYY-MM-DD" (day/week, keyed by the bucket's own start date) or "YYYY-MM" (month). */
function bucketKey(date: Date, timezone: string, granularity: Granularity): string {
  if (granularity === 'day') return dateKeyInTimezone(date, timezone);
  if (granularity === 'week') return dateKeyInTimezone(startOfWeekInTimezone(date, timezone), timezone);
  return dateKeyInTimezone(startOfMonthInTimezone(date, timezone), timezone).slice(0, 7);
}

/**
 * Every bucket key spanning [startDate, endDate], in order, including
 * buckets with no underlying rows — a trend chart with silently-missing
 * zero points reads as "no data available", not "zero that day". Steps by
 * `endOfMonthInTimezone(cursor) + 1ms` for month buckets specifically (not
 * a flat 30/31-day increment) so variable month lengths and this file's
 * only real timezone (Asia/Manila, no DST) never drift the boundary.
 */
function enumerateBuckets(startDate: Date, endDate: Date, timezone: string, granularity: Granularity): string[] {
  const keys: string[] = [];
  let cursor =
    granularity === 'day'
      ? startOfDayInTimezone(startDate, timezone)
      : granularity === 'week'
        ? startOfWeekInTimezone(startDate, timezone)
        : startOfMonthInTimezone(startDate, timezone);
  // Safety backstop against an unexpectedly-inverted range looping forever.
  let guard = 0;
  while (cursor.getTime() <= endDate.getTime() && guard < 10_000) {
    keys.push(bucketKey(cursor, timezone, granularity));
    if (granularity === 'day') cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    else if (granularity === 'week') cursor = new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000);
    else cursor = new Date(endOfMonthInTimezone(cursor, timezone).getTime() + 1);
    guard += 1;
  }
  return keys;
}

/** Local-hour (0-23) `date` falls on in `timezone` — same "no date-fns-tz, format with Intl and parse" approach as lib/utils/timezone.ts's own getDatePartsInTimezone (see that file's header for why). */
function hourInTimezone(date: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }).format(date);
  return Number(hour) % 24;
}

const WEEKDAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
/** Monday-first weekday label `date` falls on in `timezone`. */
function weekdayInTimezone(date: Date, timezone: string): (typeof WEEKDAY_ORDER)[number] {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  return (WEEKDAY_ORDER as readonly string[]).includes(short) ? (short as (typeof WEEKDAY_ORDER)[number]) : 'Mon';
}

export type AnalyticsQuery = ReportDateRangeQueryInput;

const NON_CANCELLED_ORDER: Prisma.OrderWhereInput['status'] = { not: 'CANCELLED' };

export class AnalyticsService {
  private static async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }

  private static async getOrgTimezone(organizationId: string): Promise<string> {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } });
    return org.timezone;
  }

  private static async resolveRange(organizationId: string, query: AnalyticsQuery) {
    return ReportingService.resolveReportDateRange(organizationId, query);
  }

  // ===========================================================================
  // Revenue dashboard
  // ===========================================================================

  static async getRevenueDashboard(organizationId: string, query: AnalyticsQuery) {
    if (query.branchId) await this.assertBranchInOrg(organizationId, query.branchId);
    const timezone = await this.getOrgTimezone(organizationId);
    const range = await this.resolveRange(organizationId, query);
    const prior = previousPeriod(range.startDate, range.endDate);
    const granularity = chooseGranularity(range.startDate, range.endDate);

    const orderWhere = (r: { startDate: Date; endDate: Date }): Prisma.OrderWhereInput => ({
      organizationId,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      status: NON_CANCELLED_ORDER,
      createdAt: { gte: r.startDate, lte: r.endDate },
    });
    const cateringWhere = (r: { startDate: Date; endDate: Date }): Prisma.CateringPaymentWhereInput => ({
      organizationId,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      type: 'BALANCE',
      status: 'COMPLETED',
      createdAt: { gte: r.startDate, lte: r.endDate },
    });

    const [orders, cateringPayments, priorOrders, priorCatering] = await Promise.all([
      prisma.order.findMany({ where: orderWhere(range), select: { total: true, createdAt: true } }),
      prisma.cateringPayment.findMany({ where: cateringWhere(range), select: { amount: true, createdAt: true } }),
      prisma.order.aggregate({ where: orderWhere(prior), _sum: { total: true } }),
      prisma.cateringPayment.aggregate({ where: cateringWhere(prior), _sum: { amount: true } }),
    ]);

    const buckets = new Map<string, Prisma.Decimal>();
    for (const key of enumerateBuckets(range.startDate, range.endDate, timezone, granularity)) buckets.set(key, ZERO);
    for (const order of orders) {
      const key = bucketKey(order.createdAt, timezone, granularity);
      buckets.set(key, (buckets.get(key) ?? ZERO).plus(order.total));
    }
    for (const payment of cateringPayments) {
      const key = bucketKey(payment.createdAt, timezone, granularity);
      buckets.set(key, (buckets.get(key) ?? ZERO).plus(payment.amount));
    }
    const trend = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, revenue]) => ({ bucket, revenue }));

    const orderRevenue = sumDecimal(orders.map((o) => o.total));
    const cateringRevenue = sumDecimal(cateringPayments.map((p) => p.amount));
    const totalRevenue = orderRevenue.plus(cateringRevenue);
    const previousTotalRevenue = new Prisma.Decimal(priorOrders._sum.total ?? 0).plus(
      new Prisma.Decimal(priorCatering._sum.amount ?? 0),
    );

    return {
      startDate: range.startDate,
      endDate: range.endDate,
      branchId: query.branchId ?? null,
      granularity,
      trend,
      totalRevenue,
      orderRevenue,
      cateringRevenue,
      orderCount: orders.length,
      averageOrderValue: orders.length > 0 ? orderRevenue.dividedBy(orders.length) : ZERO,
      previousPeriod: { startDate: prior.startDate, endDate: prior.endDate, totalRevenue: previousTotalRevenue },
      percentChangeVsPreviousPeriod: percentChange(totalRevenue, previousTotalRevenue),
    };
  }

  // ===========================================================================
  // Profit dashboard — the sole method here sourced from the ledger, not
  // operational tables. See class header for why.
  // ===========================================================================

  static async getProfitDashboard(organizationId: string, query: AnalyticsQuery) {
    // No explicit assertBranchInOrg call here, unlike every other method
    // below — ReportingService.generateIncomeStatement already asserts a
    // supplied branchId belongs to this org before doing any work (see its
    // own first line), and it's the very first call this method makes, so
    // a bad branchId still 404s immediately without a redundant check.
    const timezone = await this.getOrgTimezone(organizationId);
    const range = await this.resolveRange(organizationId, query);
    const granularity = chooseGranularity(range.startDate, range.endDate);

    // Whole-range totals: one authoritative call, independent of the
    // per-bucket loop below — tests/integration/analytics/analytics-service
    // .test.ts asserts the bucketed netProfit figures sum to this exact
    // totals.netProfit, proving the two never drift apart.
    const totals = await ReportingService.generateIncomeStatement(organizationId, {
      startDate: range.startDate,
      endDate: range.endDate,
      branchId: query.branchId,
    });

    const bucketRanges: Array<{ key: string; startDate: Date; endDate: Date }> = [];
    let cursor =
      granularity === 'day'
        ? startOfDayInTimezone(range.startDate, timezone)
        : granularity === 'week'
          ? startOfWeekInTimezone(range.startDate, timezone)
          : startOfMonthInTimezone(range.startDate, timezone);
    let guard = 0;
    while (cursor.getTime() <= range.endDate.getTime() && guard < 10_000) {
      const bucketEnd =
        granularity === 'day'
          ? new Date(cursor.getTime() + 24 * 60 * 60 * 1000 - 1)
          : granularity === 'week'
            ? new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000 - 1)
            : endOfMonthInTimezone(cursor, timezone);
      bucketRanges.push({
        key: bucketKey(cursor, timezone, granularity),
        startDate: cursor.getTime() < range.startDate.getTime() ? range.startDate : cursor,
        endDate: bucketEnd.getTime() > range.endDate.getTime() ? range.endDate : bucketEnd,
      });
      cursor =
        granularity === 'day'
          ? new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
          : granularity === 'week'
            ? new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000)
            : new Date(endOfMonthInTimezone(cursor, timezone).getTime() + 1);
      guard += 1;
    }

    // Sequential, not Promise.all — each call is its own set of ledger
    // queries, and a wide range can produce a dozen-plus buckets; running
    // them one at a time keeps this from bursting a large batch of
    // concurrent queries against the same connection pool. The same
    // deliberate "N+1 is fine at this scale, flagged rather than hidden"
    // trade-off CustomerService.segmentBreakdown already documents.
    const trend: Array<{
      bucket: string;
      revenue: Prisma.Decimal;
      cogs: Prisma.Decimal;
      grossProfit: Prisma.Decimal;
      operatingExpenses: Prisma.Decimal;
      netProfit: Prisma.Decimal;
    }> = [];
    for (const b of bucketRanges) {
      const statement = await ReportingService.generateIncomeStatement(organizationId, {
        startDate: b.startDate,
        endDate: b.endDate,
        branchId: query.branchId,
      });
      trend.push({
        bucket: b.key,
        revenue: statement.revenue.total,
        cogs: statement.cogs.total,
        grossProfit: statement.grossProfit,
        operatingExpenses: statement.operatingExpenses.total,
        netProfit: statement.netProfit,
      });
    }

    return {
      startDate: range.startDate,
      endDate: range.endDate,
      branchId: query.branchId ?? null,
      granularity,
      trend,
      totals,
    };
  }

  // ===========================================================================
  // Customer analytics
  // ===========================================================================

  static async getCustomerAnalytics(organizationId: string, query: AnalyticsQuery) {
    if (query.branchId) await this.assertBranchInOrg(organizationId, query.branchId);
    const range = await this.resolveRange(organizationId, query);

    // Customer profiles carry no branchId (see schema.prisma's "Phase 8 —
    // CRM" comment #1 — a customer's relationship is with the
    // organization, not one location), so "new customers" is necessarily
    // org-wide even when a branchId filter is supplied; every other figure
    // below is branch-scoped through the Orders it's derived from.
    const newCustomers = await prisma.customer.count({
      where: { organizationId, createdAt: { gte: range.startDate, lte: range.endDate } },
    });

    const ordersInRange = await prisma.order.findMany({
      where: {
        organizationId,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        status: NON_CANCELLED_ORDER,
        customerId: { not: null },
        createdAt: { gte: range.startDate, lte: range.endDate },
      },
      select: { customerId: true, total: true },
    });
    const customerIdsInRange = Array.from(new Set(ordersInRange.map((o) => o.customerId).filter((id): id is string => id != null)));

    const spendByCustomer = new Map<string, { total: Prisma.Decimal; orderCount: number }>();
    for (const order of ordersInRange) {
      if (!order.customerId) continue;
      const existing = spendByCustomer.get(order.customerId);
      if (existing) {
        existing.total = existing.total.plus(order.total);
        existing.orderCount += 1;
      } else {
        spendByCustomer.set(order.customerId, { total: new Prisma.Decimal(order.total), orderCount: 1 });
      }
    }

    // "Repeat" = had at least one non-cancelled order before this period
    // started — i.e., this period wasn't their first purchase.
    const priorOrderCustomerIds =
      customerIdsInRange.length > 0
        ? await prisma.order.findMany({
            where: {
              organizationId,
              status: NON_CANCELLED_ORDER,
              customerId: { in: customerIdsInRange },
              createdAt: { lt: range.startDate },
            },
            select: { customerId: true },
            distinct: ['customerId'],
          })
        : [];
    const repeatCustomerIds = new Set(priorOrderCustomerIds.map((o) => o.customerId));
    const repeatCustomers = customerIdsInRange.filter((id) => repeatCustomerIds.has(id)).length;

    const topCustomerIds = Array.from(spendByCustomer.entries())
      .sort(([, a], [, b]) => b.total.comparedTo(a.total))
      .slice(0, 10)
      .map(([id]) => id);
    const topCustomerProfiles = topCustomerIds.length > 0
      ? await prisma.customer.findMany({ where: { id: { in: topCustomerIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nameById = new Map(topCustomerProfiles.map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(' ')]));
    const topCustomers = topCustomerIds.map((id) => {
      const spend = spendByCustomer.get(id);
      return { customerId: id, name: nameById.get(id) ?? 'Unknown customer', totalSpend: spend?.total ?? ZERO, orderCount: spend?.orderCount ?? 0 };
    });

    // Lifetime (all-time) RFM segment mix, for context alongside this
    // period's activity — see CustomerService.segmentBreakdown's own doc
    // comment for why it's necessarily all-time and org-wide (RFM has no
    // date-range concept in this build) and its N+1 scaling caveat, which
    // applies here too since this just calls through to it.
    const segmentBreakdown = await CustomerService.segmentBreakdown(organizationId);

    return {
      startDate: range.startDate,
      endDate: range.endDate,
      branchId: query.branchId ?? null,
      newCustomers,
      customersOrderingInRange: customerIdsInRange.length,
      repeatCustomers,
      repeatRate: customerIdsInRange.length > 0 ? Math.round((repeatCustomers / customerIdsInRange.length) * 1000) / 10 : 0,
      topCustomers,
      segmentBreakdown,
    };
  }

  // ===========================================================================
  // Product analytics
  // ===========================================================================

  static async getProductAnalytics(organizationId: string, query: AnalyticsQuery) {
    if (query.branchId) await this.assertBranchInOrg(organizationId, query.branchId);
    const range = await this.resolveRange(organizationId, query);

    const rows = await prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: {
        order: {
          organizationId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          status: NON_CANCELLED_ORDER,
          createdAt: { gte: range.startDate, lte: range.endDate },
        },
      },
      _sum: { quantity: true, lineTotal: true },
      _count: true,
    });

    const menuItemIds = rows.map((r) => r.menuItemId);
    const menuItems = menuItemIds.length > 0
      ? await prisma.menuItem.findMany({
          where: { id: { in: menuItemIds } },
          select: { id: true, name: true, categoryId: true, category: { select: { id: true, name: true } } },
        })
      : [];
    // Explicit generic + populate-by-loop, not `new Map(menuItems.map(...))`
    // — the same TS inference gap ReportingService.aggregateLinesByAccountType
    // documents (a Map built straight from a Prisma-typed .map() callback
    // collapses its value type to `{}` under this project's strict +
    // noUncheckedIndexedAccess settings; see CLAUDE.md -> Known Issues).
    type MenuItemLookup = { id: string; name: string; categoryId: string; category: { id: string; name: string } };
    const menuItemById = new Map<string, MenuItemLookup>();
    for (const m of menuItems) menuItemById.set(m.id, m);

    const productRows = rows.map((r) => {
      const menuItem = menuItemById.get(r.menuItemId);
      return {
        menuItemId: r.menuItemId,
        name: menuItem?.name ?? 'Unknown item',
        categoryId: menuItem?.categoryId ?? null,
        categoryName: menuItem?.category.name ?? 'Uncategorized',
        quantitySold: r._sum.quantity ?? 0,
        revenue: r._sum.lineTotal ?? ZERO,
        orderLineCount: r._count,
      };
    });

    const topByRevenue = [...productRows].sort((a, b) => b.revenue.comparedTo(a.revenue)).slice(0, 10);
    const topByQuantity = [...productRows].sort((a, b) => b.quantitySold - a.quantitySold).slice(0, 10);

    // Derived from `productRows` (already in memory from the single
    // groupBy + menu-item lookup above) — no second OrderItem scan.
    const categoryTotals = new Map<string, { categoryId: string | null; categoryName: string; revenue: Prisma.Decimal; quantitySold: number }>();
    for (const row of productRows) {
      const key = row.categoryId ?? 'uncategorized';
      const existing = categoryTotals.get(key);
      if (existing) {
        existing.revenue = existing.revenue.plus(row.revenue);
        existing.quantitySold += row.quantitySold;
      } else {
        categoryTotals.set(key, { categoryId: row.categoryId, categoryName: row.categoryName, revenue: row.revenue, quantitySold: row.quantitySold });
      }
    }
    const revenueByCategory = Array.from(categoryTotals.values()).sort((a, b) => b.revenue.comparedTo(a.revenue));

    return {
      startDate: range.startDate,
      endDate: range.endDate,
      branchId: query.branchId ?? null,
      topProductsByRevenue: topByRevenue,
      topProductsByQuantity: topByQuantity,
      revenueByCategory,
    };
  }

  // ===========================================================================
  // Channel analytics
  // ===========================================================================

  static async getChannelAnalytics(organizationId: string, query: AnalyticsQuery) {
    if (query.branchId) await this.assertBranchInOrg(organizationId, query.branchId);
    const timezone = await this.getOrgTimezone(organizationId);
    const range = await this.resolveRange(organizationId, query);

    const [byType, cateringPayments, ordersForTiming] = await Promise.all([
      prisma.order.groupBy({
        by: ['type'],
        where: {
          organizationId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          status: NON_CANCELLED_ORDER,
          createdAt: { gte: range.startDate, lte: range.endDate },
        },
        _sum: { total: true },
        _count: true,
      }),
      prisma.cateringPayment.findMany({
        where: {
          organizationId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          type: 'BALANCE',
          status: 'COMPLETED',
          createdAt: { gte: range.startDate, lte: range.endDate },
        },
        select: { amount: true, eventId: true },
      }),
      prisma.order.findMany({
        where: {
          organizationId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          status: NON_CANCELLED_ORDER,
          createdAt: { gte: range.startDate, lte: range.endDate },
        },
        select: { createdAt: true, total: true },
      }),
    ]);

    const cateringRevenue = sumDecimal(cateringPayments.map((p) => p.amount));
    const cateringEventCount = new Set(cateringPayments.map((p) => p.eventId)).size;

    const hourBuckets = new Map<number, { revenue: Prisma.Decimal; orderCount: number }>();
    const weekdayBuckets = new Map<string, { revenue: Prisma.Decimal; orderCount: number }>();
    for (let h = 0; h < 24; h += 1) hourBuckets.set(h, { revenue: ZERO, orderCount: 0 });
    for (const day of WEEKDAY_ORDER) weekdayBuckets.set(day, { revenue: ZERO, orderCount: 0 });
    for (const order of ordersForTiming) {
      const hour = hourInTimezone(order.createdAt, timezone);
      const hourBucket = hourBuckets.get(hour)!;
      hourBucket.revenue = hourBucket.revenue.plus(order.total);
      hourBucket.orderCount += 1;

      const weekday = weekdayInTimezone(order.createdAt, timezone);
      const weekdayBucket = weekdayBuckets.get(weekday)!;
      weekdayBucket.revenue = weekdayBucket.revenue.plus(order.total);
      weekdayBucket.orderCount += 1;
    }

    return {
      startDate: range.startDate,
      endDate: range.endDate,
      branchId: query.branchId ?? null,
      byType: byType.map((r) => ({ type: r.type, revenue: r._sum.total ?? ZERO, orderCount: r._count })),
      catering: { revenue: cateringRevenue, eventCount: cateringEventCount },
      salesByHour: Array.from(hourBuckets.entries()).sort(([a], [b]) => a - b).map(([hour, v]) => ({ hour, ...v })),
      salesByDayOfWeek: WEEKDAY_ORDER.map((weekday) => ({ weekday, ...weekdayBuckets.get(weekday)! })),
    };
  }

  // ===========================================================================
  // Inventory analytics
  // ===========================================================================

  static async getInventoryAnalytics(organizationId: string, query: AnalyticsQuery) {
    if (query.branchId) await this.assertBranchInOrg(organizationId, query.branchId);
    const range = await this.resolveRange(organizationId, query);

    const [wasteRecords, purchaseOrders, consumptionTransactions] = await Promise.all([
      prisma.wasteRecord.findMany({
        where: {
          organizationId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          createdAt: { gte: range.startDate, lte: range.endDate },
        },
        include: { inventoryItem: { include: { ingredient: true } } },
      }),
      prisma.purchaseOrder.aggregate({
        where: {
          organizationId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          receivedAt: { gte: range.startDate, lte: range.endDate },
        },
        _sum: { total: true },
        _count: true,
      }),
      // COGS as actually recognized via recipe-based consumption — see
      // InventoryService.consumeForOrder, which sets unitCostAtTime from
      // the ingredient's costPerUnit at consumption time. Mirrors
      // InventoryService.getCogsForOrder's own formula, generalized across
      // the date range instead of one order.
      prisma.inventoryTransaction.findMany({
        where: {
          organizationId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          type: 'SALE_CONSUMPTION',
          createdAt: { gte: range.startDate, lte: range.endDate },
        },
        select: { quantityDelta: true, unitCostAtTime: true },
      }),
    ]);

    const wasteByIngredient = new Map<string, { ingredientId: string; name: string; quantity: Prisma.Decimal; cost: Prisma.Decimal }>();
    for (const record of wasteRecords) {
      const ingredient = record.inventoryItem.ingredient;
      const cost = record.quantity.times(ingredient.costPerUnit);
      const existing = wasteByIngredient.get(ingredient.id);
      if (existing) {
        existing.quantity = existing.quantity.plus(record.quantity);
        existing.cost = existing.cost.plus(cost);
      } else {
        wasteByIngredient.set(ingredient.id, { ingredientId: ingredient.id, name: ingredient.name, quantity: record.quantity, cost });
      }
    }
    const byIngredient = Array.from(wasteByIngredient.values()).sort((a, b) => b.cost.comparedTo(a.cost));
    const totalWasteCost = sumDecimal(byIngredient.map((r) => r.cost));

    const foodCost = sumDecimal(
      consumptionTransactions.map((t) => t.quantityDelta.negated().times(t.unitCostAtTime ?? 0)),
    );

    const lowStockItems = query.branchId
      ? await InventoryService.getLowStockItems(organizationId, query.branchId)
      : (
          await Promise.all(
            (await prisma.branch.findMany({ where: { organizationId }, select: { id: true } })).map((b) =>
              InventoryService.getLowStockItems(organizationId, b.id),
            ),
          )
        ).flat();

    return {
      startDate: range.startDate,
      endDate: range.endDate,
      branchId: query.branchId ?? null,
      wasteCost: { total: totalWasteCost, byIngredient },
      purchaseSpend: { total: new Prisma.Decimal(purchaseOrders._sum.total ?? 0), orderCount: purchaseOrders._count },
      foodCost,
      lowStockItems,
      lowStockCount: lowStockItems.filter((i) => i.stockLevel === 'LOW').length,
      criticalStockCount: lowStockItems.filter((i) => i.stockLevel === 'CRITICAL').length,
    };
  }

  // ===========================================================================
  // Operational analytics
  // ===========================================================================

  static async getOperationalAnalytics(organizationId: string, query: AnalyticsQuery) {
    if (query.branchId) await this.assertBranchInOrg(organizationId, query.branchId);
    const range = await this.resolveRange(organizationId, query);

    const [reservationsByStatus, cateringEventsByStatus, deliveriesByStatus, activeTableCount, tablesUsed, kitchenHistory] = await Promise.all([
      prisma.reservation.groupBy({
        by: ['status'],
        where: {
          organizationId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          startAt: { gte: range.startDate, lte: range.endDate },
        },
        _count: true,
      }),
      prisma.cateringEvent.groupBy({
        by: ['status'],
        where: {
          organizationId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          eventDate: { gte: range.startDate, lte: range.endDate },
        },
        _count: true,
      }),
      prisma.deliveryOrder.groupBy({
        by: ['status'],
        where: {
          organizationId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          createdAt: { gte: range.startDate, lte: range.endDate },
        },
        _count: true,
      }),
      prisma.restaurantTable.count({ where: { organizationId, ...(query.branchId ? { branchId: query.branchId } : {}), active: true } }),
      prisma.order.findMany({
        where: {
          organizationId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          type: 'DINE_IN',
          tableId: { not: null },
          createdAt: { gte: range.startDate, lte: range.endDate },
        },
        select: { tableId: true },
        distinct: ['tableId'],
      }),
      // "Kitchen" figure (§76's dashboard names it alongside Reservations/
      // Tables/Delivery/Catering): average minutes from an order first
      // entering PREPARING to first reaching READY, for orders whose
      // PREPARING transition falls in range — the timing data Phase 5's
      // kitchen board itself is built on (OrderStatusHistory), not a new
      // measurement.
      prisma.orderStatusHistory.findMany({
        where: {
          order: { organizationId, ...(query.branchId ? { branchId: query.branchId } : {}) },
          toStatus: { in: ['PREPARING', 'READY'] },
          createdAt: { gte: range.startDate, lte: range.endDate },
        },
        select: { orderId: true, toStatus: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const preparingAt = new Map<string, Date>();
    const prepDurationsMinutes: number[] = [];
    for (const row of kitchenHistory) {
      if (row.toStatus === 'PREPARING' && !preparingAt.has(row.orderId)) {
        preparingAt.set(row.orderId, row.createdAt);
      } else if (row.toStatus === 'READY') {
        const started = preparingAt.get(row.orderId);
        if (started) {
          prepDurationsMinutes.push((row.createdAt.getTime() - started.getTime()) / 60000);
          preparingAt.delete(row.orderId); // one pairing per order — a second READY (e.g. after a correction) isn't double-counted.
        }
      }
    }
    const avgKitchenPrepMinutes =
      prepDurationsMinutes.length > 0
        ? Math.round((prepDurationsMinutes.reduce((sum, m) => sum + m, 0) / prepDurationsMinutes.length) * 10) / 10
        : null;

    return {
      startDate: range.startDate,
      endDate: range.endDate,
      branchId: query.branchId ?? null,
      reservationsByStatus: reservationsByStatus.map((r) => ({ status: r.status, count: r._count })),
      cateringEventsByStatus: cateringEventsByStatus.map((r) => ({ status: r.status, count: r._count })),
      deliveriesByStatus: deliveriesByStatus.map((r) => ({ status: r.status, count: r._count })),
      tables: { active: activeTableCount, usedInRange: tablesUsed.length, utilizationRate: activeTableCount > 0 ? Math.round((tablesUsed.length / activeTableCount) * 1000) / 10 : 0 },
      kitchen: { avgPrepToReadyMinutes: avgKitchenPrepMinutes, ordersMeasured: prepDurationsMinutes.length },
    };
  }
}
