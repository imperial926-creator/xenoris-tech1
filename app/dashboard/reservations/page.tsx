import { PhasePlaceholder } from '@/components/dashboard/phase-placeholder';

export default function ReservationsPage() {
  return (
    <PhasePlaceholder
      title="Reservations"
      phase={3}
      description="Availability engine, table assignment, deposits, confirmation/cancellation, no-show handling, and double-booking prevention."
    />
  );
}
