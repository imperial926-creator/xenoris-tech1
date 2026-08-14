import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { BranchService } from '@/services/branches/BranchService';
import { ReservationBoard } from '@/components/reservations/reservation-board';

export default async function ReservationsPage() {
  const session = requireAuthenticated(await getSession());
  const branches = await BranchService.list(session.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reservations</h1>
        <p className="text-sm text-muted-foreground">
          Search table availability, book reservations, and manage confirmations, seating,
          no-shows, cancellations, and deposits. Double-booking is rejected by the database
          itself, not just this UI.
        </p>
      </div>
      <ReservationBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
