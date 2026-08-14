import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { BranchService } from '@/services/branches/BranchService';
import { DeliveryBoard } from '@/components/delivery/delivery-board';

export default async function DeliveryPage() {
  const session = requireAuthenticated(await getSession());
  const branches = await BranchService.list(session.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Delivery</h1>
        <p className="text-sm text-muted-foreground">
          Delivery zones, driver profiles, and dispatch. A delivery order&apos;s fee is snapshotted
          from its zone at order time and included in the order&apos;s total — see the Orders page
          for the full charge. Drivers see only their own assigned deliveries on their{' '}
          <a className="underline" href="/dashboard/my-deliveries">
            My Deliveries
          </a>{' '}
          page.
        </p>
      </div>
      <DeliveryBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
