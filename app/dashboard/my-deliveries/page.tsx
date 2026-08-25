import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { MyDeliveries } from '@/components/delivery/my-deliveries';

export default async function MyDeliveriesPage() {
  requireAuthenticated(await getSession());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Deliveries</h1>
        <p className="text-sm text-muted-foreground">
          Only deliveries assigned to your own driver profile — never another driver&apos;s (master
          spec §19). If you don&apos;t see a driver profile listed here, ask a manager to create one
          for your account under Delivery.
        </p>
      </div>
      <MyDeliveries />
    </div>
  );
}
