import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { BranchService } from '@/services/branches/BranchService';
import { FinanceBoard } from '@/components/finance/finance-board';

export default async function FinancePage() {
  const session = requireAuthenticated(await getSession());
  const branches = await BranchService.list(session.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="text-sm text-muted-foreground">
          Double-entry accounting: chart of accounts, journal entries, trial balance, accounting
          periods, vendors, and expenses. Revenue, COGS, and deposit postings from orders,
          reservations, catering, and inventory happen automatically — see{' '}
          <code className="text-xs">CLAUDE.md</code> for the design reasoning. This board is
          restricted to Owner/Administrator/Accountant roles.
        </p>
      </div>
      <FinanceBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
