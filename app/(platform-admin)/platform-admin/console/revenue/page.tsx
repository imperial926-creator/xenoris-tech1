'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface RevenueData {
  saasRevenue: { mrr: string; arr: string; mrrMovement: Record<string, string>; grossRevenueThisPeriod: string; netRevenueThisPeriod: string };
  restaurantGrossSales: { totalRestaurantGrossSales: string; totalOrders: number; averageOrderValue: string; label: string };
  planPopularity: Array<{ planId: string; planName: string; subscriberCount: number }>;
  topRestaurants: Array<{ organizationId: string; organizationName: string; planName: string; monthlyValue: string }>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

// Master spec's Revenue Analytics — MRR movement breakdown
// (NEW + EXPANSION + REACTIVATION - CONTRACTION - CHURNED = NET NEW MRR)
// and Plan Popularity, kept structurally separate from restaurant gross
// sales (see PlatformAnalyticsService's header — VERY IMPORTANT, per spec).
export default function RevenuePage() {
  const [data, setData] = useState<RevenueData | null>(null);

  useEffect(() => {
    fetch('/api/platform-admin/analytics/revenue?preset=last_30_days')
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Revenue</h1>

      <Card>
        <CardHeader>
          <CardTitle>MRR Movement (30d) — NET NEW = NEW + EXPANSION + REACTIVATION − CONTRACTION − CHURNED</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-6">
          <Stat label="New" value={`₱${data.saasRevenue.mrrMovement.newMrr}`} />
          <Stat label="Expansion" value={`₱${data.saasRevenue.mrrMovement.expansionMrr}`} />
          <Stat label="Reactivation" value={`₱${data.saasRevenue.mrrMovement.reactivationMrr}`} />
          <Stat label="Contraction" value={`₱${data.saasRevenue.mrrMovement.contractionMrr}`} />
          <Stat label="Churned" value={`₱${data.saasRevenue.mrrMovement.churnedMrr}`} />
          <Stat label="Net New MRR" value={`₱${data.saasRevenue.mrrMovement.netNewMrr}`} />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>SaaS Subscription Revenue</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Stat label="MRR" value={`₱${data.saasRevenue.mrr}`} />
            <Stat label="ARR" value={`₱${data.saasRevenue.arr}`} />
            <Stat label="Gross Revenue (30d)" value={`₱${data.saasRevenue.grossRevenueThisPeriod}`} />
            <Stat label="Net Revenue (30d)" value={`₱${data.saasRevenue.netRevenueThisPeriod}`} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Restaurant Transaction Value (not platform revenue)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Stat label="Gross Sales" value={`₱${data.restaurantGrossSales.totalRestaurantGrossSales}`} />
            <Stat label="Orders" value={data.restaurantGrossSales.totalOrders} />
            <Stat label="Avg Order Value" value={`₱${data.restaurantGrossSales.averageOrderValue}`} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plan Popularity</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2">Plan</th>
                <th className="py-2">Active Subscribers</th>
              </tr>
            </thead>
            <tbody>
              {data.planPopularity.map((p) => (
                <tr key={p.planId} className="border-b last:border-0">
                  <td className="py-2">{p.planName}</td>
                  <td className="py-2">{p.subscriberCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top Restaurants by MRR Contribution</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2">Restaurant</th>
                <th className="py-2">Plan</th>
                <th className="py-2">Monthly Value</th>
              </tr>
            </thead>
            <tbody>
              {data.topRestaurants.map((r) => (
                <tr key={r.organizationId} className="border-b last:border-0">
                  <td className="py-2">{r.organizationName}</td>
                  <td className="py-2">{r.planName}</td>
                  <td className="py-2">₱{r.monthlyValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
