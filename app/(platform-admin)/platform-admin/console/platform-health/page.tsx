'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface HealthEvent {
  id: string;
  type: string;
  severity: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
  organization: { id: string; name: string } | null;
}
interface Summary {
  total: number;
  unresolved: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
}
interface AnomalyResult {
  key: string;
  label: string;
  current: number;
  previous: number;
  percentChange: number | null;
  level: string;
}

// Master spec's Platform Health / System Alerts + anomaly detection — see
// PlatformHealthService's header for exactly which real trigger points
// this covers (this is honestly NOT a full APM integration).
export default function PlatformHealthPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    fetch('/api/platform-admin/platform-health?preset=last_7_days')
      .then((r) => r.json())
      .then((d) => {
        setSummary(d.summary);
        setEvents(d.recentEvents);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runAnomalySweep = async () => {
    setRunning(true);
    const res = await fetch('/api/platform-admin/platform-health/anomalies', { method: 'POST' });
    const data = await res.json();
    setAnomalies(data.results);
    setRunning(false);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Platform Health</h1>
        <Button onClick={runAnomalySweep} disabled={running} size="sm">
          {running ? 'Running…' : 'Run Anomaly Sweep'}
        </Button>
      </div>

      {summary && (
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Events (7d)</p>
              <p className="text-lg font-semibold">{summary.total}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Unresolved</p>
              <p className="text-lg font-semibold">{summary.unresolved}</p>
            </div>
            {Object.entries(summary.bySeverity).map(([sev, count]) => (
              <div key={sev}>
                <p className="text-xs text-muted-foreground">{sev}</p>
                <p className="text-lg font-semibold">{count}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {anomalies && (
        <Card>
          <CardHeader>
            <CardTitle>Anomaly Sweep Result</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2">Metric</th>
                  <th className="py-2">Current</th>
                  <th className="py-2">Previous</th>
                  <th className="py-2">Change</th>
                  <th className="py-2">Level</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((a) => (
                  <tr key={a.key} className="border-b last:border-0">
                    <td className="py-2">{a.label}</td>
                    <td className="py-2">{a.current}</td>
                    <td className="py-2">{a.previous}</td>
                    <td className="py-2">{a.percentChange !== null ? `${a.percentChange.toFixed(0)}%` : '—'}</td>
                    <td className="py-2">{a.level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent Events</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2">Type</th>
                <th className="py-2">Severity</th>
                <th className="py-2">Message</th>
                <th className="py-2">Restaurant</th>
                <th className="py-2">Occurred</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted-foreground">
                    No health events recorded.
                  </td>
                </tr>
              )}
              {events.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="py-2 text-xs">{e.type.replace(/_/g, ' ')}</td>
                  <td className="py-2">{e.severity}</td>
                  <td className="py-2">{e.message}</td>
                  <td className="py-2">{e.organization?.name ?? '—'}</td>
                  <td className="py-2">{new Date(e.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
