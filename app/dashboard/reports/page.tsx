import { PhasePlaceholder } from '@/components/dashboard/phase-placeholder';

// The live, on-screen income statement/balance sheet/cash flow/trial
// balance were built in Phase 11 under Finance -> Reports. What's left
// here is specifically master spec §55: CSV/PDF/XLSX export of those and
// every other major report (Sales, Orders, Reservations, Customers,
// Catering, Inventory, Expenses) — never assigned to a build phase's own
// list (checked Phases 10-16), so still genuinely unbuilt.
export default function ReportsPage() {
  return (
    <PhasePlaceholder
      title="Exports"
      phase={null}
      description="CSV/PDF/XLSX export of every major report (Sales, Orders, Reservations, Customers, Catering, Inventory, Expenses, Income Statement, Balance Sheet, Cash Flow) — master spec §55. The reports themselves are live at Finance → Reports; this page is only the download/export layer, which was never assigned to a build phase."
    />
  );
}
