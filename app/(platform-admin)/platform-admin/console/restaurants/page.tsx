'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface RestaurantsData {
  lifecycleFunnel: Record<string, number>;
  atRiskRestaurants: Array<{
    organizationId: string;
    score: number;
    classification: string;
    computedAt: string;
    organization: { id: string; name: string };
  }>;
}

// Master spec's restaurant lifecycle funnel + Restaurant Engagement Score
// (decision support only — see EngagementScoreService's header: nothing
// here auto-cancels an account; low scores only create a follow-up task).
export default function RestaurantsPage() {
  const [data, setData] = useState<RestaurantsData | null>(null);
  const [computing, setComputing] = useState(false);

  const load = () => {
    fetch('/api/platform-admin/analytics/restaurants')
      .then((r) => r.json())
      .then(setData);
  };

  useEffect(() => {
    load();
  }, []);

  const runSnapshots = async () => {
    setComputing(true);
    // Kicks a full-platform engagement re-score via the cron-guarded route
    // is not possible from the browser (secret-guarded) — instead this
    // triggers one org at a time isn't practical either; operators should
    // schedule the cron route. This button is a no-op placeholder pointing
    // to that fact rather than silently doing nothing.
    setComputing(false);
    alert('Engagement scores refresh via the scheduled cron job (see deployment checklist) — this view shows the latest computed snapshots.');
  };

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Restaurants & Churn</h1>
        <Button variant="outline" size="sm" onClick={runSnapshots} disabled={computing}>
          About engagement refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lifecycle Funnel (current state, all restaurants)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {Object.entries(data.lifecycleFunnel).map(([state, count]) => (
            <div key={state}>
              <p className="text-xs text-muted-foreground">{state.replace(/_/g, ' ')}</p>
              <p className="text-lg font-semibold">{count}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>At-Risk Restaurants (engagement score)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            For retention follow-up and decision support only — never used to automatically cancel or downgrade an account.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2">Restaurant</th>
                <th className="py-2">Score</th>
                <th className="py-2">Classification</th>
                <th className="py-2">Computed</th>
              </tr>
            </thead>
            <tbody>
              {data.atRiskRestaurants.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-muted-foreground">
                    No at-risk restaurants in the latest snapshots.
                  </td>
                </tr>
              )}
              {data.atRiskRestaurants.map((r) => (
                <tr key={r.organizationId} className="border-b last:border-0">
                  <td className="py-2">{r.organization.name}</td>
                  <td className="py-2">{r.score}/100</td>
                  <td className="py-2">{r.classification.replace('_', ' ')}</td>
                  <td className="py-2">{new Date(r.computedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
