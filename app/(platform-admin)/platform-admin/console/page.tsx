'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Overview {
  saasRevenue: { mrr: string; arr: string; mrrMovement: Record<string, string> };
  restaurantGrossSales: { totalRestaurantGrossSales: string; totalOrders: number; label: string };
  subscriptions: { activeSubscriptions: number; pastDueSubscriptions: number; suspendedSubscriptions: number; churnRate: number };
  totalRestaurants: number;
  complaints: { total: number; resolved: number; escalated: number; resolutionRate: number };
  actionCenter: { total: number; critical: number; high: number; overdue: number };
  platformHealth: { total: number; unresolved: number };
  lifecycleFunnel: Record<string, number>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

// Master Data Analytics spec's Executive Overview — the single top-level
// admin dashboard. `restaurantGrossSales` and `saasRevenue` are rendered as
// clearly separate cards with distinct labels — VERY IMPORTANT (per the
// spec, twice): never add them together. See PlatformAnalyticsService's header.
export default function ExecutiveOverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);

  useEffect(() => {
    fetch('/api/platform-admin/analytics/overview?preset=last_30_days')
      .then((r) => r.json())
      .then((d) => setOverview(d.overview));
  }, []);

  if (!overview) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Executive Overview</h1>
        <p className="text-sm text-muted-foreground">Last 30 days, platform-wide.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>SaaS Subscription Revenue</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="MRR" value={`₱${overview.saasRevenue.mrr}`} />
          <Stat label="ARR" value={`₱${overview.saasRevenue.arr}`} />
          <Stat label="Net New MRR (30d)" value={`₱${overview.saasRevenue.mrrMovement.netNewMrr}`} />
          <Stat label="Churned MRR (30d)" value={`₱${overview.saasRevenue.mrrMovement.churnedMrr}`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Restaurant Transaction Value (NOT platform revenue)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Gross Sales" value={`₱${overview.restaurantGrossSales.totalRestaurantGrossSales}`} />
          <Stat label="Orders" value={overview.restaurantGrossSales.totalOrders} />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Subscriptions</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Stat label="Total Restaurants" value={overview.totalRestaurants} />
            <Stat label="Active" value={overview.subscriptions.activeSubscriptions} />
            <Stat label="Past Due" value={overview.subscriptions.pastDueSubscriptions} />
            <Stat label="Suspended" value={overview.subscriptions.suspendedSubscriptions} />
            <Stat label="Churn Rate" value={`${overview.subscriptions.churnRate}%`} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Action Center</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Stat label="Open" value={overview.actionCenter.total} />
            <Stat label="Critical" value={overview.actionCenter.critical} />
            <Stat label="High" value={overview.actionCenter.high} />
            <Stat label="Overdue" value={overview.actionCenter.overdue} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Complaints</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Stat label="Total (30d)" value={overview.complaints.total} />
            <Stat label="Resolution Rate" value={`${overview.complaints.resolutionRate}%`} />
            <Stat label="Escalated" value={overview.complaints.escalated} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform Health</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Stat label="Events (30d)" value={overview.platformHealth.total} />
            <Stat label="Unresolved" value={overview.platformHealth.unresolved} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Restaurant Lifecycle Funnel</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {Object.entries(overview.lifecycleFunnel).map(([state, count]) => (
            <Stat key={state} label={state.replace(/_/g, ' ')} value={count} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
