'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AppUsageData {
  appUsage: { dau: number; wau: number; mau: number; totalSessionsLast30Days: number };
  featureUsage: Array<{ feature: string; usageCount: number }>;
  customerAnalytics: { totalCustomersAllTime: number; newCustomers: number; totalDiningOrders: number };
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

// Master spec's Application Popularity (customer mobile app DAU/WAU/MAU,
// from CAPP's existing privacy-conscious CustomerAnalyticsEvent log) +
// Feature Usage ranking + aggregated-only Customer Analytics (no
// per-customer personal data — spec's explicit rule).
export default function AppUsagePage() {
  const [data, setData] = useState<AppUsageData | null>(null);

  useEffect(() => {
    fetch('/api/platform-admin/analytics/app-usage?preset=last_30_days')
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">App & Feature Usage</h1>

      <Card>
        <CardHeader>
          <CardTitle>Customer App (CAPP) Popularity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="DAU" value={data.appUsage.dau} />
          <Stat label="WAU" value={data.appUsage.wau} />
          <Stat label="MAU" value={data.appUsage.mau} />
          <Stat label="Sessions (30d)" value={data.appUsage.totalSessionsLast30Days} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aggregated Customer Analytics</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Total Diners (all time)" value={data.customerAnalytics.totalCustomersAllTime} />
          <Stat label="New Diners (30d)" value={data.customerAnalytics.newCustomers} />
          <Stat label="Dining Orders (30d)" value={data.customerAnalytics.totalDiningOrders} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feature Usage Ranking (30d)</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2">Feature</th>
                <th className="py-2">Usage Count</th>
              </tr>
            </thead>
            <tbody>
              {data.featureUsage.map((f) => (
                <tr key={f.feature} className="border-b last:border-0">
                  <td className="py-2">{f.feature}</td>
                  <td className="py-2">{f.usageCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
