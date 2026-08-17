import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { BranchService } from '@/services/branches/BranchService';
import { InsightsBoard } from '@/components/ai/insights-board';

export default async function AiInsightsPage() {
  const session = requireAuthenticated(await getSession());
  const branches = await BranchService.list(session.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Business Insights</h1>
        <p className="text-sm text-muted-foreground">
          What changed, why it likely changed, what requires attention, and what opportunity exists — generated
          deterministically from the same Analytics and Finance data as the rest of this dashboard (see{' '}
          <code className="text-xs">docs/architecture.md</code>). Every figure shown here is real and sourced; nothing is
          invented. Requires both Analytics and Finance access, the same boundary as the Profit dashboard.
        </p>
      </div>
      <InsightsBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
