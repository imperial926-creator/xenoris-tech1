'use client';

import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Branch {
  id: string;
  name: string;
}

// Every dashboard below mirrors AnalyticsService's return shape verbatim —
// Prisma.Decimal serializes to a plain numeric string over JSON, same
// convention components/finance/finance-board.tsx already documents.

interface RevenueDashboard {
  startDate: string;
  endDate: string;
  branchId: string | null;
  granularity: 'day' | 'week' | 'month';
  trend: { bucket: string; revenue: string }[];
  totalRevenue: string;
  orderRevenue: string;
  cateringRevenue: string;
  orderCount: number;
  averageOrderValue: string;
  previousPeriod: { startDate: string; endDate: string; totalRevenue: string };
  percentChangeVsPreviousPeriod: number | null;
}

interface AccountLineTotal {
  accountId: string;
  code: string;
  name: string;
  type: string;
  amount: string;
}
interface IncomeStatementTotals {
  revenue: { accounts: AccountLineTotal[]; total: string };
  cogs: { accounts: AccountLineTotal[]; total: string };
  grossProfit: string;
  operatingExpenses: { accounts: AccountLineTotal[]; total: string };
  netProfit: string;
}
interface ProfitDashboard {
  startDate: string;
  endDate: string;
  branchId: string | null;
  granularity: 'day' | 'week' | 'month';
  trend: { bucket: string; revenue: string; cogs: string; grossProfit: string; operatingExpenses: string; netProfit: string }[];
  totals: IncomeStatementTotals;
}

interface CustomerAnalytics {
  startDate: string;
  endDate: string;
  branchId: string | null;
  newCustomers: number;
  customersOrderingInRange: number;
  repeatCustomers: number;
  repeatRate: number;
  topCustomers: { customerId: string; name: string; totalSpend: string; orderCount: number }[];
  segmentBreakdown: Record<string, number>;
}

interface ProductRow {
  menuItemId: string;
  name: string;
  categoryId: string | null;
  categoryName: string;
  quantitySold: number;
  revenue: string;
  orderLineCount: number;
}
interface ProductAnalytics {
  startDate: string;
  endDate: string;
  branchId: string | null;
  topProductsByRevenue: ProductRow[];
  topProductsByQuantity: ProductRow[];
  revenueByCategory: { categoryId: string | null; categoryName: string; revenue: string; quantitySold: number }[];
}

interface ChannelAnalytics {
  startDate: string;
  endDate: string;
  branchId: string | null;
  byType: { type: string; revenue: string; orderCount: number }[];
  catering: { revenue: string; eventCount: number };
  salesByHour: { hour: number; revenue: string; orderCount: number }[];
  salesByDayOfWeek: { weekday: string; revenue: string; orderCount: number }[];
}

interface LowStockItem {
  id: string;
  quantityOnHand: string;
  reorderPoint: string | null;
  criticalPoint: string | null;
  stockLevel: 'CRITICAL' | 'LOW' | 'OK';
  ingredient: { name: string; stockUnit: { abbreviation: string } };
}
interface InventoryAnalytics {
  startDate: string;
  endDate: string;
  branchId: string | null;
  wasteCost: { total: string; byIngredient: { ingredientId: string; name: string; quantity: string; cost: string }[] };
  purchaseSpend: { total: string; orderCount: number };
  foodCost: string;
  lowStockItems: LowStockItem[];
  lowStockCount: number;
  criticalStockCount: number;
}

interface OperationalAnalytics {
  startDate: string;
  endDate: string;
  branchId: string | null;
  reservationsByStatus: { status: string; count: number }[];
  cateringEventsByStatus: { status: string; count: number }[];
  deliveriesByStatus: { status: string; count: number }[];
  tables: { active: number; usedInRange: number; utilizationRate: number };
  kitchen: { avgPrepToReadyMinutes: number | null; ordersMeasured: number };
}

const DATE_RANGE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'this_year', label: 'This year' },
  { key: 'custom', label: 'Custom range' },
] as const;
type Preset = (typeof DATE_RANGE_PRESETS)[number]['key'];

function formatMoney(value: string | undefined): string {
  if (value === undefined) return '—';
  const n = Number(value);
  const abs = Math.abs(n).toFixed(2);
  return n < 0 ? `-₱${abs}` : `₱${abs}`;
}
function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${value > 0 ? '+' : ''}${value}%`;
}

type DashboardKey = 'revenue' | 'profit' | 'customers' | 'products' | 'channels' | 'inventory' | 'operations';
const DASHBOARDS: { key: DashboardKey; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'profit', label: 'Profit' },
  { key: 'customers', label: 'Customers' },
  { key: 'products', label: 'Products' },
  { key: 'channels', label: 'Channels' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'operations', label: 'Operations' },
];

const STOCK_BADGE: Record<string, string> = {
  CRITICAL: 'bg-destructive/15 text-destructive',
  LOW: 'bg-amber-100 text-amber-900',
  OK: 'bg-secondary text-secondary-foreground',
};

export function AnalyticsBoard({ branches }: { branches: Branch[] }) {
  const [dashboard, setDashboard] = useState<DashboardKey>('revenue');
  const [branchId, setBranchId] = useState('');
  const [preset, setPreset] = useState<Preset>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [revenue, setRevenue] = useState<RevenueDashboard | null>(null);
  const [profit, setProfit] = useState<ProfitDashboard | null>(null);
  const [customers, setCustomers] = useState<CustomerAnalytics | null>(null);
  const [products, setProducts] = useState<ProductAnalytics | null>(null);
  const [channels, setChannels] = useState<ChannelAnalytics | null>(null);
  const [inventory, setInventory] = useState<InventoryAnalytics | null>(null);
  const [operations, setOperations] = useState<OperationalAnalytics | null>(null);

  const queryString = useCallback(() => {
    const params = new URLSearchParams({ preset });
    if (branchId) params.set('branchId', branchId);
    if (preset === 'custom') {
      if (customStart) params.set('startDate', customStart);
      if (customEnd) params.set('endDate', customEnd);
    }
    return params.toString();
  }, [preset, branchId, customStart, customEnd]);

  const load = useCallback(async () => {
    if (preset === 'custom' && (!customStart || !customEnd)) return;
    setError(null);
    const endpoints: Record<DashboardKey, string> = {
      revenue: 'revenue', profit: 'profit', customers: 'customers', products: 'products',
      channels: 'channels', inventory: 'inventory', operations: 'operations',
    };
    const res = await fetch(`/api/analytics/${endpoints[dashboard]}?${queryString()}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? `Failed to load ${dashboard} analytics.`); return; }
    if (dashboard === 'revenue') setRevenue(data.revenue);
    if (dashboard === 'profit') setProfit(data.profit);
    if (dashboard === 'customers') setCustomers(data.customers);
    if (dashboard === 'products') setProducts(data.products);
    if (dashboard === 'channels') setChannels(data.channels);
    if (dashboard === 'inventory') setInventory(data.inventory);
    if (dashboard === 'operations') setOperations(data.operations);
  }, [dashboard, queryString, preset, customStart, customEnd]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {DASHBOARDS.map((d) => (
          <Button key={d.key} type="button" size="sm" variant={dashboard === d.key ? 'default' : 'outline'} onClick={() => setDashboard(d.key)}>
            {d.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">Branch</Label>
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">Date range</Label>
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            {DATE_RANGE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
        {preset === 'custom' && (
          <>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" className="h-9" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" className="h-9" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </div>
          </>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {dashboard === 'revenue' && <RevenueTab data={revenue} />}
      {dashboard === 'profit' && <ProfitTab data={profit} />}
      {dashboard === 'customers' && <CustomersTab data={customers} />}
      {dashboard === 'products' && <ProductsTab data={products} />}
      {dashboard === 'channels' && <ChannelsTab data={channels} />}
      {dashboard === 'inventory' && <InventoryTab data={inventory} />}
      {dashboard === 'operations' && <OperationsTab data={operations} />}
    </div>
  );
}

function TrendTable({ rows, valueLabel }: { rows: { bucket: string; value: string }[]; valueLabel: string }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No data in range.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-1 font-medium">Period</th>
          <th className="py-1 text-right font-medium">{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.bucket} className="border-b last:border-0">
            <td className="py-1 pr-3 font-mono text-xs text-muted-foreground">{r.bucket}</td>
            <td className="py-1 text-right">{formatMoney(r.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RevenueTab({ data }: { data: RevenueDashboard | null }) {
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const cards = [
    { label: 'Total revenue', value: formatMoney(data.totalRevenue) },
    { label: 'vs. previous period', value: formatPercent(data.percentChangeVsPreviousPeriod) },
    { label: 'Order revenue', value: formatMoney(data.orderRevenue) },
    { label: 'Catering revenue', value: formatMoney(data.cateringRevenue) },
    { label: 'Orders', value: String(data.orderCount) },
    { label: 'Average order value', value: formatMoney(data.averageOrderValue) },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{c.label}</p><p className="text-lg font-semibold">{c.value}</p></CardContent></Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Revenue trend ({data.granularity})</CardTitle></CardHeader>
        <CardContent><TrendTable rows={data.trend.map((t) => ({ bucket: t.bucket, value: t.revenue }))} valueLabel="Revenue" /></CardContent>
      </Card>
    </div>
  );
}

function ProfitTab({ data }: { data: ProfitDashboard | null }) {
  if (!data) return <p className="text-sm text-muted-foreground">Loading… (requires Finance access)</p>;
  const t = data.totals;
  const cards = [
    { label: 'Revenue', value: formatMoney(t.revenue.total) },
    { label: 'COGS', value: formatMoney(t.cogs.total) },
    { label: 'Gross profit', value: formatMoney(t.grossProfit) },
    { label: 'Operating expenses', value: formatMoney(t.operatingExpenses.total) },
    { label: 'Net profit', value: formatMoney(t.netProfit) },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{c.label}</p><p className="text-lg font-semibold">{c.value}</p></CardContent></Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Net profit trend ({data.granularity})</CardTitle></CardHeader>
        <CardContent>
          {data.trend.length === 0 ? <p className="text-xs text-muted-foreground">No data in range.</p> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1 font-medium">Period</th>
                  <th className="py-1 text-right font-medium">Revenue</th>
                  <th className="py-1 text-right font-medium">Gross profit</th>
                  <th className="py-1 text-right font-medium">Net profit</th>
                </tr>
              </thead>
              <tbody>
                {data.trend.map((row) => (
                  <tr key={row.bucket} className="border-b last:border-0">
                    <td className="py-1 pr-3 font-mono text-xs text-muted-foreground">{row.bucket}</td>
                    <td className="py-1 pr-3 text-right">{formatMoney(row.revenue)}</td>
                    <td className="py-1 pr-3 text-right">{formatMoney(row.grossProfit)}</td>
                    <td className="py-1 text-right font-medium">{formatMoney(row.netProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CustomersTab({ data }: { data: CustomerAnalytics | null }) {
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const cards = [
    { label: 'New customers', value: String(data.newCustomers) },
    { label: 'Customers ordering', value: String(data.customersOrderingInRange) },
    { label: 'Repeat customers', value: String(data.repeatCustomers) },
    { label: 'Repeat rate', value: `${data.repeatRate}%` },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{c.label}</p><p className="text-lg font-semibold">{c.value}</p></CardContent></Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Top customers by spend (this range)</CardTitle></CardHeader>
        <CardContent>
          {data.topCustomers.length === 0 ? <p className="text-xs text-muted-foreground">No customer orders in range.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {data.topCustomers.map((c) => (
                  <tr key={c.customerId} className="border-b last:border-0">
                    <td className="py-1 pr-3">{c.name}</td>
                    <td className="py-1 pr-3 text-xs text-muted-foreground">{c.orderCount} order{c.orderCount === 1 ? '' : 's'}</td>
                    <td className="py-1 text-right">{formatMoney(c.totalSpend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Lifetime RFM segment mix</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.entries(data.segmentBreakdown).map(([segment, count]) => (
            <span key={segment} className="rounded bg-muted px-2 py-1 text-xs">{segment}: {count}</span>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ProductTable({ rows }: { rows: ProductRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No product sales in range.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-1 font-medium">Item</th>
          <th className="py-1 font-medium">Category</th>
          <th className="py-1 text-right font-medium">Qty</th>
          <th className="py-1 text-right font-medium">Revenue</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.menuItemId} className="border-b last:border-0">
            <td className="py-1 pr-3">{r.name}</td>
            <td className="py-1 pr-3 text-xs text-muted-foreground">{r.categoryName}</td>
            <td className="py-1 pr-3 text-right">{r.quantitySold}</td>
            <td className="py-1 text-right">{formatMoney(r.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProductsTab({ data }: { data: ProductAnalytics | null }) {
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Top products by revenue</CardTitle></CardHeader>
        <CardContent><ProductTable rows={data.topProductsByRevenue} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Top products by quantity sold</CardTitle></CardHeader>
        <CardContent><ProductTable rows={data.topProductsByQuantity} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Revenue by category</CardTitle></CardHeader>
        <CardContent>
          {data.revenueByCategory.length === 0 ? <p className="text-xs text-muted-foreground">No data in range.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {data.revenueByCategory.map((c) => (
                  <tr key={c.categoryId ?? 'uncategorized'} className="border-b last:border-0">
                    <td className="py-1 pr-3">{c.categoryName}</td>
                    <td className="py-1 pr-3 text-xs text-muted-foreground">{c.quantitySold} sold</td>
                    <td className="py-1 text-right">{formatMoney(c.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChannelsTab({ data }: { data: ChannelAnalytics | null }) {
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {data.byType.map((t) => (
          <Card key={t.type}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t.type}</p><p className="text-lg font-semibold">{formatMoney(t.revenue)}</p><p className="text-xs text-muted-foreground">{t.orderCount} orders</p></CardContent></Card>
        ))}
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">CATERING</p><p className="text-lg font-semibold">{formatMoney(data.catering.revenue)}</p><p className="text-xs text-muted-foreground">{data.catering.eventCount} events</p></CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Sales by hour of day</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-6 gap-1 text-center sm:grid-cols-12">
            {data.salesByHour.map((h) => (
              <div key={h.hour} className="rounded border p-1">
                <p className="text-[10px] text-muted-foreground">{h.hour}:00</p>
                <p className="text-xs font-medium">{h.orderCount}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Sales by day of week</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {data.salesByDayOfWeek.map((d) => (
                <tr key={d.weekday} className="border-b last:border-0">
                  <td className="py-1 pr-3">{d.weekday}</td>
                  <td className="py-1 pr-3 text-xs text-muted-foreground">{d.orderCount} orders</td>
                  <td className="py-1 text-right">{formatMoney(d.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function InventoryTab({ data }: { data: InventoryAnalytics | null }) {
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const cards = [
    { label: 'Waste cost', value: formatMoney(data.wasteCost.total) },
    { label: 'Purchase spend', value: formatMoney(data.purchaseSpend.total) },
    { label: 'Food cost (consumption)', value: formatMoney(data.foodCost) },
    { label: 'Low / Critical stock', value: `${data.lowStockCount} / ${data.criticalStockCount}` },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{c.label}</p><p className="text-lg font-semibold">{c.value}</p></CardContent></Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Waste cost by ingredient</CardTitle></CardHeader>
        <CardContent>
          {data.wasteCost.byIngredient.length === 0 ? <p className="text-xs text-muted-foreground">No waste recorded in range.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {data.wasteCost.byIngredient.map((i) => (
                  <tr key={i.ingredientId} className="border-b last:border-0">
                    <td className="py-1 pr-3">{i.name}</td>
                    <td className="py-1 pr-3 text-xs text-muted-foreground">{i.quantity} wasted</td>
                    <td className="py-1 text-right">{formatMoney(i.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Low / critical stock items</CardTitle></CardHeader>
        <CardContent>
          {data.lowStockItems.length === 0 ? <p className="text-xs text-muted-foreground">Nothing below its reorder point.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {data.lowStockItems.map((i) => (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="py-1 pr-3">{i.ingredient.name}</td>
                    <td className="py-1 pr-3 text-xs text-muted-foreground">{i.quantityOnHand} {i.ingredient.stockUnit.abbreviation} on hand</td>
                    <td className="py-1 text-right"><span className={`rounded px-2 py-1 text-xs font-medium ${STOCK_BADGE[i.stockLevel]}`}>{i.stockLevel}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OperationsTab({ data }: { data: OperationalAnalytics | null }) {
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const statusGroups: { title: string; rows: { status: string; count: number }[] }[] = [
    { title: 'Reservations', rows: data.reservationsByStatus },
    { title: 'Catering events', rows: data.cateringEventsByStatus },
    { title: 'Deliveries', rows: data.deliveriesByStatus },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Table utilization</p><p className="text-lg font-semibold">{data.tables.utilizationRate}%</p><p className="text-xs text-muted-foreground">{data.tables.usedInRange} of {data.tables.active} active tables used</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Avg. kitchen prep-to-ready</p><p className="text-lg font-semibold">{data.kitchen.avgPrepToReadyMinutes !== null ? `${data.kitchen.avgPrepToReadyMinutes} min` : '—'}</p><p className="text-xs text-muted-foreground">{data.kitchen.ordersMeasured} orders measured</p></CardContent></Card>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {statusGroups.map((g) => (
          <Card key={g.title}>
            <CardHeader><CardTitle className="text-base">{g.title}</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {g.rows.length === 0 ? <p className="text-xs text-muted-foreground">None in range.</p> : g.rows.map((r) => (
                <div key={r.status} className="flex justify-between text-sm"><span>{r.status}</span><span className="font-medium">{r.count}</span></div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
