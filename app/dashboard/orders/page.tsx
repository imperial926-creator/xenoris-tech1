import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { BranchService } from '@/services/branches/BranchService';
import { OrderBoard } from '@/components/orders/order-board';

export default async function OrdersPage() {
  const session = requireAuthenticated(await getSession());
  const branches = await BranchService.list(session.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="text-sm text-muted-foreground">
          Dine-in, takeout, and delivery orders. Pricing is always computed server-side from the
          current menu — the order form is a preview, not the final charge. Invoices can be
          issued once an order is fully paid.
        </p>
      </div>
      <OrderBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
