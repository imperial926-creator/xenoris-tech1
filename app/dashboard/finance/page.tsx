import { PhasePlaceholder } from '@/components/dashboard/phase-placeholder';

export default function FinancePage() {
  return (
    <PhasePlaceholder
      title="Finance"
      phase={10}
      description="Double-entry accounting ledger: chart of accounts, journal entries, expenses, receivables, payables."
    />
  );
}
