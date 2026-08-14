import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { BranchService } from '@/services/branches/BranchService';
import { TableBoard } from '@/components/dashboard/table-board';

export default async function TablesPage() {
  const session = requireAuthenticated(await getSession());
  const branches = await BranchService.list(session.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tables</h1>
        <p className="text-sm text-muted-foreground">
          Sections, tables, and live status per branch. Status changes are validated server-side
          and recorded in the table&apos;s status history.
        </p>
      </div>
      <TableBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
