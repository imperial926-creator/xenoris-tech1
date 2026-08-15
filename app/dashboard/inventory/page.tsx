import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { BranchService } from '@/services/branches/BranchService';
import { InventoryBoard } from '@/components/inventory/inventory-board';

export default async function InventoryPage() {
  const session = requireAuthenticated(await getSession());
  const branches = await BranchService.list(session.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Ingredients and units are shared across branches; stock, purchase orders, and counts are
          per-branch. Completing an order with a recipe-linked menu item consumes ingredients
          automatically — see <code className="text-xs">CLAUDE.md</code> for the design reasoning.
        </p>
      </div>
      <InventoryBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
