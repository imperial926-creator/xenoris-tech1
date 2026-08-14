import { PhasePlaceholder } from '@/components/dashboard/phase-placeholder';

export default function ReportsPage() {
  return (
    <PhasePlaceholder
      title="Reports"
      phase={11}
      description="Income statement, balance sheet, cash flow, trial balance — generated from the ledger, with CSV/PDF/XLSX export."
    />
  );
}
