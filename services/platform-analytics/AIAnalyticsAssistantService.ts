import 'server-only';
import { getAIProvider, type AiInsightForNarration } from '@/lib/ai/AIProvider';
import { PlatformAnalyticsService } from './PlatformAnalyticsService';
import { ActionCenterService } from '@/services/platform-billing/ActionCenterService';

export interface PlatformInsight {
  category: string;
  severity: 'info' | 'warning' | 'critical';
  fact: string;
  interpretation: string;
  recommendation: string | null;
  metrics: Array<{ label: string; value: string }>;
}

/**
 * Master Data Analytics spec §70/§71's "AI Business Analyst" — hooks into
 * the SAME `lib/ai/AIProvider.ts` seam CAPP Phase 13's `InsightService`
 * already established, rather than building a second AI integration. Same
 * safety boundary: a configured provider may only rephrase ALREADY-
 * COMPUTED figures from `PlatformAnalyticsService`/`ActionCenterService`
 * into prose — it is never given database access or asked to invent a
 * number. No provider is configured in this codebase (`getAIProvider()`
 * always returns `UnconfiguredAIProvider` until one is wired in), so this
 * always falls back to the deterministic, template-based insights below —
 * exactly the "not_configured" pattern `InsightService.generateInsights`
 * already uses.
 *
 * The spec's explicit requirement — distinguish FACT from INTERPRETATION
 * from RECOMMENDATION — is enforced by construction: `PlatformInsight` has
 * separate `fact`/`interpretation`/`recommendation` fields, never one
 * blended sentence, and every `fact` is a verbatim number from a real
 * service call.
 */
export class AIAnalyticsAssistantService {
  static async generateInsights(range: { startDate: Date; endDate: Date }) {
    const [overview, actionAnalytics] = await Promise.all([
      PlatformAnalyticsService.executiveOverview(range),
      ActionCenterService.actionAnalytics(range),
    ]);

    const insights: PlatformInsight[] = [];

    insights.push({
      category: 'revenue',
      severity: 'info',
      fact: `MRR is ₱${overview.saasRevenue.mrr}, ARR is ₱${overview.saasRevenue.arr}. Net new MRR this period: ₱${overview.saasRevenue.mrrMovement.netNewMrr}.`,
      interpretation:
        Number(overview.saasRevenue.mrrMovement.netNewMrr) >= 0
          ? 'Subscription revenue grew net of churn and contraction this period.'
          : 'Churned and contracted MRR outweighed new and expansion MRR this period.',
      recommendation:
        Number(overview.saasRevenue.mrrMovement.churnedMrr) > 0
          ? 'Review restaurants contributing to churned MRR in the Churn & Retention dashboard.'
          : null,
      metrics: [
        { label: 'MRR', value: overview.saasRevenue.mrr },
        { label: 'ARR', value: overview.saasRevenue.arr },
        { label: 'Net new MRR', value: overview.saasRevenue.mrrMovement.netNewMrr },
      ],
    });

    insights.push({
      category: 'complaints',
      severity: overview.complaints.escalated > 0 ? 'warning' : 'info',
      fact: `${overview.complaints.total} complaints logged this period, ${overview.complaints.resolved} resolved (${overview.complaints.resolutionRate}%), ${overview.complaints.escalated} escalated.`,
      interpretation:
        overview.complaints.escalated > 0
          ? 'Some complaints breached their SLA and required escalation.'
          : 'No complaints breached SLA this period.',
      recommendation: overview.complaints.escalated > 0 ? 'Review escalated complaints in Customer Support → Complaints.' : null,
      metrics: [
        { label: 'Total complaints', value: String(overview.complaints.total) },
        { label: 'Resolution rate', value: `${overview.complaints.resolutionRate}%` },
      ],
    });

    insights.push({
      category: 'action_center',
      severity: overview.actionCenter.overdue > 0 ? 'warning' : 'info',
      fact: `${overview.actionCenter.total} open actions (${overview.actionCenter.critical} critical, ${overview.actionCenter.high} high), ${overview.actionCenter.overdue} overdue. Resolution rate this period: ${actionAnalytics.resolutionRate}%.`,
      interpretation:
        overview.actionCenter.overdue > 0
          ? 'Some actions have passed their due date without resolution.'
          : 'No open actions are currently overdue.',
      recommendation: overview.actionCenter.overdue > 0 ? 'Review overdue items in the Action Center.' : null,
      metrics: [
        { label: 'Open actions', value: String(overview.actionCenter.total) },
        { label: 'Overdue', value: String(overview.actionCenter.overdue) },
      ],
    });

    const provider = getAIProvider();
    let narrative: string | null = null;
    let narrativeStatus: 'not_configured' | 'generated' | 'failed' = 'not_configured';
    if (provider.name !== 'unconfigured') {
      try {
        const forNarration: AiInsightForNarration[] = insights.map((i) => ({
          category: i.category,
          severity: i.severity,
          title: i.category,
          summary: `${i.fact} ${i.interpretation}`,
          recommendations: i.recommendation ? [i.recommendation] : [],
          metrics: i.metrics,
        }));
        const result = await provider.narrate({
          insights: forNarration,
          context: {
            organizationName: 'Platform (all restaurants)',
            currency: 'PHP',
            periodLabel: `${range.startDate.toISOString().slice(0, 10)} to ${range.endDate.toISOString().slice(0, 10)}`,
          },
        });
        narrative = result.narrative;
        narrativeStatus = 'generated';
      } catch {
        narrativeStatus = 'failed';
      }
    }

    return { insights, narrative, narrativeStatus };
  }
}
