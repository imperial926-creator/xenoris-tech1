import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { CustomerBoard } from '@/components/crm/customer-board';

export default async function CustomersPage() {
  requireAuthenticated(await getSession());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <p className="text-sm text-muted-foreground">
          Real customer profiles — history, RFM segmentation, and lifetime value, computed live
          from orders, reservations, and catering events. See <code className="text-xs">CLAUDE.md</code>{' '}
          for the design reasoning.
        </p>
      </div>
      <CustomerBoard />
    </div>
  );
}
