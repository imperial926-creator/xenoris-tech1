import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { BranchService } from '@/services/branches/BranchService';
import { CateringBoard } from '@/components/catering/catering-board';

export default async function CateringPage() {
  const session = requireAuthenticated(await getSession());
  const branches = await BranchService.list(session.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Catering</h1>
        <p className="text-sm text-muted-foreground">
          The full funnel: Inquiry → Quote → Accept → Deposit → Event → Final payment. Accepting a
          quote automatically creates its catering event — see <code className="text-xs">CLAUDE.md</code>{' '}
          for the design reasoning.
        </p>
      </div>
      <CateringBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
