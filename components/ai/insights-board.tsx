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

// Mirrors services/ai/InsightService.ts's return shapes verbatim — same
// "Prisma.Decimal serializes to a plain numeric string over JSON"
// convention components/analytics/analytics-board.tsx already documents.
// Every insight metric here is already-formatted text (InsightService's own
// formatMoney/formatPct), not a raw number this component re-derives —
// master spec §38's "never fabricate financial figures" applies to display
// too: this board only ever shows what the service already computed.

interface InsightMetric {
  label: string;
  value: string;
  previousValue?: string;
  percentChange?: number | null;
}
interface Insight {
  id: string;
  category: 'SALES' | 'MARGIN' | 'EXPENSE' | 'CUSTOMER' | 'PRODUCT' | 'INVENTORY' | 'DEMAND';
  severity: 'ATTENTION' | 'OPPORTUNITY' | 'INFO';
  title: string;
  summary: string;
  recommendations: string[];
  metrics: InsightMetric[];
  dataSources: string[];
}
interface InsightsResponse {
  startDate: string;
  endDate: string;
  branchId: string | null;
  generatedAt: string;
  insights: Insight[];
  narrative: string | null;
  narrativeStatus: 'not_configured' | 'generated' | 'failed';
}

interface ForecastBucket {
  bucket: string;
  projectedRevenue: string;
}
interface ForecastResponse {
  status: 'ok' | 'insufficient_data';
  granularity: 'day' | 'week' | 'month';
  history: { bucket: string; revenue: string }[];
  forecast: ForecastBucket[];
  method: string | null;
  disclaimer: string;
  dataSources: string[];
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

const SEVERITY_STYLE: Record<Insight['severity'], string> = {
  ATTENTION: 'border-destructive/40 bg-destructive/5',
  OPPORTUNITY: 'border-emerald-300 bg-emerald-50',
  INFO: 'border-border bg-muted/30',
};
const SEVERITY_BADGE: Record<Insight['severity'], string> = {
  ATTENTION: 'bg-destructive/15 text-destructive',
  OPPORTUNITY: 'bg-emerald-100 text-emerald-900',
  INFO: 'bg-secondary text-secondary-foreground',
};
const CATEGORY_LABEL: Record<Insight['category'], string> = {
  SALES: 'Sales',
  MARGIN: 'Margin',
  EXPENSE: 'Expense',
  CUSTOMER: 'Customer',
  PRODUCT: 'Product',
  INVENTORY: 'Inventory',
  DEMAND: 'Demand',
};

// A plain function returning JSX (called via `.map(renderInsightCard)`
// below), not a separately-invoked `<InsightCard .../>` component — this
// codebase's other board components (e.g. TrendTable/ProductTable in
// components/analytics/analytics-board.tsx) always call a sub-component
// directly with a single explicit prop, never from inside a `.map()`'s JSX
// tag. Keeping the same shape here avoids a real diagnostic: without
// @prisma/client and 'react' resolved in this sandbox (see CLAUDE.md's
// Known Issues), TS falls back to raw structural prop-checking for
// locally-defined components and treats the special `key` prop React
// strips at the JSX-tag call site as a genuine excess property, which
// fails a `.map()`-sourced array's item type in a way it wouldn't for a
// directly-invoked component. Assigning `key` directly on the returned
// `<Card>` below sidesteps that path entirely and is functionally
// identical.
function renderInsightCard(insight: Insight) {
  return (
    <Card key={insight.id} className={SEVERITY_STYLE[insight.severity]}>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${SEVERITY_BADGE[insight.severity]}`}>{insight.severity}</span>
          <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{CATEGORY_LABEL[insight.category]}</span>
        </div>
        <p className="text-sm font-semibold">{insight.title}</p>
        <p className="text-sm text-muted-foreground">{insight.summary}</p>
        {insight.metrics.length > 0 && (
          <div className="flex flex-wrap gap-3 border-t pt-2">
            {insight.metrics.map((m) => (
              <div key={m.label}>
                <p className="text-[10px] text-muted-foreground">{m.label}</p>
                <p className="text-sm font-medium">
                  {m.value}
                  {m.previousValue !== undefined && <span className="ml-1 text-xs font-normal text-muted-foreground">(was {m.previousValue})</span>}
                </p>
              </div>
            ))}
          </div>
        )}
        {insight.recommendations.length > 0 && (
          <ul className="list-inside list-disc space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
            {insight.recommendations.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <p className="border-t pt-1 text-[10px] text-muted-foreground">Source: {insight.dataSources.join(', ')}</p>
      </CardContent>
    </Card>
  );
}

export function InsightsBoard({ branches }: { branches: Branch[] }) {
  const [branchId, setBranchId] = useState('');
  const [preset, setPreset] = useState<Preset>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [insightsResponse, setInsightsResponse] = useState<InsightsResponse | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);

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
    const qs = queryString();
    const [insightsRes, forecastRes] = await Promise.all([fetch(`/api/ai/insights?${qs}`), fetch(`/api/ai/forecast?${qs}`)]);
    const insightsData = await insightsRes.json();
    if (!insightsRes.ok) {
      setError(insightsData.error ?? 'Failed to load AI insights.');
      return;
    }
    setInsightsResponse(insightsData.insights);
    const forecastData = await forecastRes.json();
    if (forecastRes.ok) setForecast(forecastData.forecast);
  }, [queryString, preset, customStart, customEnd]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">Branch</Label>
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">Date range</Label>
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            {DATE_RANGE_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
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
        <Button type="button" size="sm" variant="outline" onClick={() => load()}>
          Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!insightsResponse ? (
        <p className="text-sm text-muted-foreground">Loading… (requires Analytics and Finance access)</p>
      ) : (
        <>
          {insightsResponse.narrativeStatus === 'generated' && insightsResponse.narrative && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">{insightsResponse.narrative}</CardContent>
            </Card>
          )}

          {insightsResponse.insights.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing crossed an attention threshold for this period — no significant sales, margin, expense, customer, product,
              inventory, or demand changes vs. the previous period of equal length.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">{insightsResponse.insights.map(renderInsightCard)}</div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue forecast</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!forecast ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : forecast.status === 'insufficient_data' ? (
                <p className="text-xs text-muted-foreground">{forecast.disclaimer}</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-3">
                    {forecast.forecast.map((f, i) => (
                      <div key={f.bucket}>
                        <p className="text-[10px] text-muted-foreground">Next {sequenceLabel(i)} {forecast.granularity}</p>
                        <p className="text-sm font-medium">{f.projectedRevenue}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">{forecast.disclaimer}</p>
                  <p className="text-[10px] text-muted-foreground">Source: {forecast.dataSources.join(', ')}</p>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function sequenceLabel(zeroBasedIndex: number): string {
  const n = zeroBasedIndex + 1;
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}
