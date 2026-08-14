import { PhasePlaceholder } from '@/components/dashboard/phase-placeholder';

export default function TablesPage() {
  return (
    <PhasePlaceholder
      title="Tables"
      phase={2}
      description="Table sections, table status (available/reserved/occupied/cleaning/etc.), and business hours configuration."
    />
  );
}
