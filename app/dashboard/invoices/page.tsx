import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { BranchService } from '@/services/branches/BranchService';
import { InvoiceBoard } from '@/components/orders/invoice-board';

export default async function InvoicesPage() {
  const session = requireAuthenticated(await getSession());
  const branches = await BranchService.list(session.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
        <p className="text-sm text-muted-foreground">
          Sequential, per-branch invoice numbers issued from fully-paid orders. This is not yet
          BIR-accredited official-receipt numbering — see <code className="text-xs">CLAUDE.md</code>{' '}
          for the compliance note.
        </p>
      </div>
      <InvoiceBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
