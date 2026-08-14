import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { BranchService } from '@/services/branches/BranchService';
import { KitchenBoard } from '@/components/kitchen/kitchen-board';

export default async function KitchenPage() {
  const session = requireAuthenticated(await getSession());
  const branches = await BranchService.list(session.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Kitchen Display</h1>
        <p className="text-sm text-muted-foreground">
          New, accepted, preparing, and ready tickets for this branch. Moving a ticket forward
          here is the same order-status transition used everywhere else in the system — the
          kitchen board is a view, not a second source of truth.
        </p>
      </div>
      <KitchenBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
