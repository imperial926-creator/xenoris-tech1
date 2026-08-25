'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Insight {
  category: string;
  severity: string;
  fact: string;
  interpretation: string;
  recommendation: string | null;
}
interface Result {
  insights: Insight[];
  narrative: string | null;
  narrativeStatus: 'not_configured' | 'generated' | 'failed';
}

// Master spec §70-71's "AI Business Analyst" — every insight is shown as
// three distinct labeled parts (FACT / INTERPRETATION / RECOMMENDATION),
// never blended, per the spec's explicit instruction. See
// AIAnalyticsAssistantService's header for the safety boundary: no AI
// provider is configured in this codebase, so `narrative` is always null
// here today — the FACT/INTERPRETATION/RECOMMENDATION breakdown below is
// deterministic and complete on its own.
export default function AiInsightsPage() {
  const [data, setData] = useState<Result | null>(null);

  useEffect(() => {
    fetch('/api/platform-admin/analytics/ai-insights?preset=last_30_days')
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">AI Business Analyst</h1>
      <p className="text-sm text-muted-foreground">
        {data.narrativeStatus === 'not_configured'
          ? 'No AI provider is configured — showing deterministic, template-based insights built directly from verified platform data.'
          : data.narrativeStatus === 'generated'
            ? 'AI-narrated summary below, generated only from the verified figures shown in each insight.'
            : 'AI narration failed — showing the underlying verified insights.'}
      </p>

      {data.narrative && (
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{data.narrative}</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {data.insights.map((insight, i) => (
          <Card key={i}>
            <CardHeader>
              <CardTitle className="capitalize">
                {insight.category.replace(/_/g, ' ')} — {insight.severity}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="font-semibold">FACT: </span>
                {insight.fact}
              </p>
              <p>
                <span className="font-semibold">INTERPRETATION: </span>
                {insight.interpretation}
              </p>
              {insight.recommendation && (
                <p>
                  <span className="font-semibold">RECOMMENDATION: </span>
                  {insight.recommendation}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
