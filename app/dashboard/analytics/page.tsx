import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { BranchService } from '@/services/branches/BranchService';
import { AnalyticsBoard } from '@/components/analytics/analytics-board';

export default async function AnalyticsPage() {
  const session = requireAuthenticated(await getSession());
  const branches = await BranchService.list(session.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Owner dashboards — Revenue, Profit, Customers, Products, Channels, Inventory, and
          Operations — all live-computed from Orders/Reservations/Catering/Inventory (and, for
          Profit specifically, the posted ledger — see{' '}
          <code className="text-xs">docs/architecture.md</code>). Profit requires Finance access
          in addition to Analytics access; every other dashboard here only requires the latter.
        </p>
      </div>
      <AnalyticsBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
