'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

// Master spec's Custom Report Builder (ADMIN → CUSTOM REPORTS) — a bounded
// metric catalog rather than an arbitrary query engine; see
// ReportQueryService's header. Export supports CSV/JSON only — see
// ExportService's header for why Excel/PDF are not implemented.
export default function ReportsPage() {
  const [metrics, setMetrics] = useState<Record<string, string>>({});
  const [metric, setMetric] = useState('');
  const [result, setResult] = useState<unknown>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetch('/api/platform-admin/reports/metrics')
      .then((r) => r.json())
      .then((d) => {
        setMetrics(d.metrics);
        setMetric(Object.keys(d.metrics)[0] ?? '');
      });
  }, []);

  const runMetric = async () => {
    if (!metric) return;
    setRunning(true);
    const res = await fetch('/api/platform-admin/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportType: metric, format: 'json' }),
    });
    const text = await res.text();
    try {
      setResult(JSON.parse(text));
    } catch {
      setResult(text);
    }
    setRunning(false);
  };

  const downloadCsv = async () => {
    if (!metric) return;
    const res = await fetch('/api/platform-admin/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportType: metric, format: 'csv' }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${metric}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Custom Reports</h1>

      <Card>
        <CardHeader>
          <CardTitle>Run a Metric</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select label="Metric" value={metric} onChange={(e) => setMetric(e.target.value)} wrapperClassName="max-w-md">
            {Object.entries(metrics).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button onClick={runMetric} disabled={running}>
              {running ? 'Running…' : 'Run'}
            </Button>
            <Button variant="outline" onClick={downloadCsv}>
              Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {result !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[500px] overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100">
              {JSON.stringify(result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
