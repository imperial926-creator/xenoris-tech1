'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Branch {
  id: string;
  name: string;
}
interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  description: string | null;
  isSystem: boolean;
  active: boolean;
}
interface JournalEntryLine {
  id: string;
  accountId: string;
  account: Account;
  debit: string;
  credit: string;
  description: string | null;
}
interface JournalEntry {
  id: string;
  branchId: string | null;
  entryDate: string;
  description: string;
  referenceType: string | null;
  referenceId: string | null;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
  reversalOfEntryId: string | null;
  lines: JournalEntryLine[];
}
interface Period {
  id: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED';
  closedAt: string | null;
}
interface Vendor {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
}
interface ExpenseCategory {
  id: string;
  name: string;
  defaultAccountId: string | null;
  defaultAccount: Account | null;
  active: boolean;
}
interface Expense {
  id: string;
  vendorId: string | null;
  vendor: Vendor | null;
  categoryId: string;
  category: ExpenseCategory;
  amount: string;
  expenseDate: string;
  paymentMethod: string;
  notes: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  journalEntryId: string | null;
}
interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  debit: string;
  credit: string;
  balance: string;
}
interface TrialBalance {
  asOfDate: string;
  accounts: TrialBalanceRow[];
  totalDebits: string;
  totalCredits: string;
  isBalanced: boolean;
}

// Phase 11 — financial reporting types, mirroring ReportingService's return
// shapes verbatim (Prisma.Decimal serializes to a plain numeric string over
// JSON, same as every other money field in this file).
interface AccountLineTotal {
  accountId: string;
  code: string;
  name: string;
  type: string;
  amount: string;
}
interface IncomeStatement {
  startDate: string;
  endDate: string;
  branchId: string | null;
  revenue: { accounts: AccountLineTotal[]; total: string };
  cogs: { accounts: AccountLineTotal[]; total: string };
  grossProfit: string;
  operatingExpenses: { accounts: AccountLineTotal[]; total: string };
  netProfit: string;
}
interface BalanceSheet {
  asOfDate: string;
  branchId: string | null;
  assets: { accounts: AccountLineTotal[]; total: string };
  liabilities: { accounts: AccountLineTotal[]; total: string };
  equity: { accounts: AccountLineTotal[]; recordedTotal: string; netIncomeToDate: string; total: string };
  totalLiabilitiesAndEquity: string;
  isBalanced: boolean;
}
interface CashFlow {
  startDate: string;
  endDate: string;
  branchId: string | null;
  operatingActivities: string;
  investingActivities: string;
  financingActivities: string;
  unclassifiedActivities: string;
  netCashFlow: string;
  beginningCash: string;
  endingCash: string;
  isReconciled: boolean;
}
interface FinancialDashboard {
  date: string;
  branchId: string | null;
  todayRevenue: string;
  todayExpenses: string;
  todayOperatingExpenses: string;
  grossProfit: string;
  netProfit: string;
  cashPosition: string;
  outstandingReceivables: string;
  outstandingPayables: string;
  inventoryValue: string;
}

const DATE_RANGE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'this_year', label: 'This year' },
  { key: 'custom', label: 'Custom range' },
] as const;

function formatMoney(value: string | undefined): string {
  if (value === undefined) return '—';
  const n = Number(value);
  const abs = Math.abs(n).toFixed(2);
  return n < 0 ? `-₱${abs}` : `₱${abs}`;
}

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE'] as const;
const EXPENSE_PAYMENT_METHODS = ['CASH', 'CARD', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'] as const;

type SectionKey = 'reports' | 'accounts' | 'journal' | 'trial-balance' | 'periods' | 'expenses';
const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'reports', label: 'Reports' },
  { key: 'accounts', label: 'Chart of Accounts' },
  { key: 'journal', label: 'Journal Entries' },
  { key: 'trial-balance', label: 'Trial Balance' },
  { key: 'periods', label: 'Periods' },
  { key: 'expenses', label: 'Expenses' },
];

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  POSTED: 'bg-secondary text-secondary-foreground',
  REVERSED: 'bg-amber-100 text-amber-900',
  OPEN: 'bg-secondary text-secondary-foreground',
  CLOSED: 'bg-muted text-muted-foreground',
  PENDING: 'bg-amber-100 text-amber-900',
  APPROVED: 'bg-secondary text-secondary-foreground',
  REJECTED: 'bg-destructive/15 text-destructive',
};

export function FinanceBoard({ branches }: { branches: Branch[] }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [section, setSection] = useState<SectionKey>('reports');
  const [error, setError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  const load = useCallback(async (branch: string) => {
    setError(null);
    try {
      const [accountsRes, entriesRes, periodsRes, vendorsRes, categoriesRes] = await Promise.all([
        fetch('/api/finance/accounts?includeInactive=true'),
        fetch('/api/finance/journal-entries'),
        fetch('/api/finance/periods'),
        fetch('/api/finance/vendors'),
        fetch('/api/finance/expense-categories'),
      ]);
      const [accountsData, entriesData, periodsData, vendorsData, categoriesData] = await Promise.all([
        accountsRes.json(), entriesRes.json(), periodsRes.json(), vendorsRes.json(), categoriesRes.json(),
      ]);
      if (!accountsRes.ok) throw new Error(accountsData.error ?? 'Failed to load chart of accounts.');
      if (!entriesRes.ok) throw new Error(entriesData.error ?? 'Failed to load journal entries.');
      if (!periodsRes.ok) throw new Error(periodsData.error ?? 'Failed to load accounting periods.');
      if (!vendorsRes.ok) throw new Error(vendorsData.error ?? 'Failed to load vendors.');
      if (!categoriesRes.ok) throw new Error(categoriesData.error ?? 'Failed to load expense categories.');
      setAccounts(accountsData.accounts);
      setJournalEntries(entriesData.entries);
      setPeriods(periodsData.periods);
      setVendors(vendorsData.vendors);
      setCategories(categoriesData.categories);

      if (branch) {
        const expensesRes = await fetch(`/api/branches/${branch}/finance/expenses`);
        const expensesData = await expensesRes.json();
        if (!expensesRes.ok) throw new Error(expensesData.error ?? 'Failed to load expenses.');
        setExpenses(expensesData.expenses);
      } else {
        setExpenses([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }, []);

  useEffect(() => {
    load(branchId);
  }, [branchId, load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="branch-select" className="text-sm">Branch (for expenses)</Label>
        <select
          id="branch-select"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
        >
          <option value="">— none —</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <Button key={s.key} type="button" variant={section === s.key ? 'default' : 'outline'} size="sm" onClick={() => setSection(s.key)}>
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {section === 'reports' && <ReportsSection branches={branches} />}
      {section === 'accounts' && <AccountsSection accounts={accounts} onChange={() => load(branchId)} />}
      {section === 'journal' && (
        <JournalSection accounts={accounts} journalEntries={journalEntries} branches={branches} branchId={branchId} onChange={() => load(branchId)} />
      )}
      {section === 'trial-balance' && <TrialBalanceSection />}
      {section === 'periods' && <PeriodsSection periods={periods} onChange={() => load(branchId)} />}
      {section === 'expenses' && (
        <ExpensesSection
          branchId={branchId}
          branches={branches}
          expenses={expenses}
          vendors={vendors}
          categories={categories}
          accounts={accounts}
          onChange={() => load(branchId)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Financial reports (Phase 11) — dashboard, income statement, balance
// sheet, cash flow. Master spec §54's report filters (date-range preset +
// branch); §36's "correctness over aggressive caching" is honored simply
// by refetching on every filter change rather than caching client-side.
// ---------------------------------------------------------------------------

type ReportTab = 'dashboard' | 'income-statement' | 'balance-sheet' | 'cash-flow';
const REPORT_TABS: { key: ReportTab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'income-statement', label: 'Income Statement' },
  { key: 'balance-sheet', label: 'Balance Sheet' },
  { key: 'cash-flow', label: 'Cash Flow' },
];

function ReportsSection({ branches }: { branches: Branch[] }) {
  const [tab, setTab] = useState<ReportTab>('dashboard');
  const [reportBranchId, setReportBranchId] = useState('');
  const [preset, setPreset] = useState<(typeof DATE_RANGE_PRESETS)[number]['key']>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [asOfDate, setAsOfDate] = useState('');

  const [dashboard, setDashboard] = useState<FinancialDashboard | null>(null);
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatement | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheet | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rangeParams = useCallback(() => {
    const params = new URLSearchParams({ preset });
    if (reportBranchId) params.set('branchId', reportBranchId);
    if (preset === 'custom') {
      if (customStart) params.set('startDate', customStart);
      if (customEnd) params.set('endDate', customEnd);
    }
    return params;
  }, [preset, customStart, customEnd, reportBranchId]);

  const loadDashboard = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    if (reportBranchId) params.set('branchId', reportBranchId);
    const res = await fetch(`/api/finance/reports/dashboard?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed to load the financial dashboard.'); return; }
    setDashboard(data.dashboard);
  }, [reportBranchId]);

  const loadIncomeStatement = useCallback(async () => {
    if (preset === 'custom' && (!customStart || !customEnd)) return;
    setError(null);
    const res = await fetch(`/api/finance/reports/income-statement?${rangeParams().toString()}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed to generate the income statement.'); return; }
    setIncomeStatement(data.incomeStatement);
  }, [rangeParams, preset, customStart, customEnd]);

  const loadBalanceSheet = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    if (reportBranchId) params.set('branchId', reportBranchId);
    if (asOfDate) params.set('asOfDate', asOfDate);
    const res = await fetch(`/api/finance/reports/balance-sheet?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed to generate the balance sheet.'); return; }
    setBalanceSheet(data.balanceSheet);
  }, [reportBranchId, asOfDate]);

  const loadCashFlow = useCallback(async () => {
    if (preset === 'custom' && (!customStart || !customEnd)) return;
    setError(null);
    const res = await fetch(`/api/finance/reports/cash-flow?${rangeParams().toString()}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed to generate the cash flow statement.'); return; }
    setCashFlow(data.cashFlow);
  }, [rangeParams, preset, customStart, customEnd]);

  useEffect(() => {
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'income-statement') loadIncomeStatement();
    if (tab === 'balance-sheet') loadBalanceSheet();
    if (tab === 'cash-flow') loadCashFlow();
  }, [tab, loadDashboard, loadIncomeStatement, loadBalanceSheet, loadCashFlow]);

  const showRangeFilter = tab === 'income-statement' || tab === 'cash-flow';
  const showAsOfFilter = tab === 'balance-sheet';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {REPORT_TABS.map((t) => (
          <Button key={t.key} type="button" size="sm" variant={tab === t.key ? 'default' : 'outline'} onClick={() => setTab(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">Branch</Label>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={reportBranchId}
            onChange={(e) => setReportBranchId(e.target.value)}
          >
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        {showRangeFilter && (
          <>
            <div>
              <Label className="text-xs">Date range</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={preset}
                onChange={(e) => setPreset(e.target.value as (typeof DATE_RANGE_PRESETS)[number]['key'])}
              >
                {DATE_RANGE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            {preset === 'custom' && (
              <>
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" className="h-9" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" className="h-9" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                </div>
              </>
            )}
          </>
        )}
        {showAsOfFilter && (
          <div>
            <Label className="text-xs">As of date (optional — defaults to now)</Label>
            <Input type="date" className="h-9" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {tab === 'dashboard' && <DashboardTab dashboard={dashboard} />}
      {tab === 'income-statement' && <IncomeStatementTab incomeStatement={incomeStatement} />}
      {tab === 'balance-sheet' && <BalanceSheetTab balanceSheet={balanceSheet} />}
      {tab === 'cash-flow' && <CashFlowTab cashFlow={cashFlow} />}
    </div>
  );
}

function DashboardTab({ dashboard }: { dashboard: FinancialDashboard | null }) {
  if (!dashboard) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const cards: { label: string; value: string }[] = [
    { label: "Today's Revenue", value: formatMoney(dashboard.todayRevenue) },
    { label: "Today's Expenses", value: formatMoney(dashboard.todayExpenses) },
    { label: 'Gross Profit', value: formatMoney(dashboard.grossProfit) },
    { label: 'Net Profit', value: formatMoney(dashboard.netProfit) },
    { label: 'Cash Position', value: formatMoney(dashboard.cashPosition) },
    { label: 'Outstanding Receivables', value: formatMoney(dashboard.outstandingReceivables) },
    { label: 'Outstanding Payables', value: formatMoney(dashboard.outstandingPayables) },
    { label: 'Inventory Value', value: formatMoney(dashboard.inventoryValue) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="text-lg font-semibold">{c.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AccountLineTable({ rows }: { rows: AccountLineTotal[] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">None.</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={r.accountId} className="border-b last:border-0">
            <td className="py-1 pr-3 font-mono text-xs text-muted-foreground">{r.code}</td>
            <td className="py-1 pr-3">{r.name}</td>
            <td className="py-1 text-right">{formatMoney(r.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function IncomeStatementTab({ incomeStatement: s }: { incomeStatement: IncomeStatement | null }) {
  if (!s) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Income statement</CardTitle>
        <p className="text-xs text-muted-foreground">{new Date(s.startDate).toLocaleDateString()} – {new Date(s.endDate).toLocaleDateString()}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Revenue</p>
          <AccountLineTable rows={s.revenue.accounts} />
          <div className="flex justify-between border-t pt-1 text-sm font-medium"><span>Total revenue</span><span>{formatMoney(s.revenue.total)}</span></div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Cost of goods sold</p>
          <AccountLineTable rows={s.cogs.accounts} />
          <div className="flex justify-between border-t pt-1 text-sm font-medium"><span>Total COGS</span><span>{formatMoney(s.cogs.total)}</span></div>
        </div>
        <div className="flex justify-between border-t pt-2 text-sm font-semibold"><span>Gross profit</span><span>{formatMoney(s.grossProfit)}</span></div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Operating expenses</p>
          <AccountLineTable rows={s.operatingExpenses.accounts} />
          <div className="flex justify-between border-t pt-1 text-sm font-medium"><span>Total operating expenses</span><span>{formatMoney(s.operatingExpenses.total)}</span></div>
        </div>
        <div className="flex justify-between border-t-2 pt-2 text-base font-bold"><span>Net profit</span><span>{formatMoney(s.netProfit)}</span></div>
      </CardContent>
    </Card>
  );
}

function BalanceSheetTab({ balanceSheet: s }: { balanceSheet: BalanceSheet | null }) {
  if (!s) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Balance sheet</CardTitle>
        <p className="text-xs text-muted-foreground">As of {new Date(s.asOfDate).toLocaleDateString()}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Assets</p>
          <AccountLineTable rows={s.assets.accounts} />
          <div className="flex justify-between border-t pt-1 text-sm font-semibold"><span>Total assets</span><span>{formatMoney(s.assets.total)}</span></div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Liabilities</p>
          <AccountLineTable rows={s.liabilities.accounts} />
          <div className="flex justify-between border-t pt-1 text-sm font-medium"><span>Total liabilities</span><span>{formatMoney(s.liabilities.total)}</span></div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Equity</p>
          <AccountLineTable rows={s.equity.accounts} />
          <div className="flex justify-between text-sm"><span>Net income (unclosed, to date)</span><span>{formatMoney(s.equity.netIncomeToDate)}</span></div>
          <div className="flex justify-between border-t pt-1 text-sm font-medium"><span>Total equity</span><span>{formatMoney(s.equity.total)}</span></div>
        </div>
        <div className="flex items-center justify-between border-t-2 pt-2 text-base font-bold">
          <span>Liabilities + equity</span>
          <span>{formatMoney(s.totalLiabilitiesAndEquity)}</span>
        </div>
        <span className={`inline-block rounded px-2 py-1 text-xs ${s.isBalanced ? 'bg-secondary text-secondary-foreground' : 'bg-destructive/15 text-destructive'}`}>
          {s.isBalanced ? 'Balanced' : 'Out of balance'}
        </span>
      </CardContent>
    </Card>
  );
}

function CashFlowTab({ cashFlow: s }: { cashFlow: CashFlow | null }) {
  if (!s) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const rows: { label: string; value: string }[] = [
    { label: 'Operating activities', value: formatMoney(s.operatingActivities) },
    { label: 'Investing activities', value: formatMoney(s.investingActivities) },
    { label: 'Financing activities', value: formatMoney(s.financingActivities) },
  ];
  if (Number(s.unclassifiedActivities) !== 0) rows.push({ label: 'Unclassified', value: formatMoney(s.unclassifiedActivities) });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cash flow statement</CardTitle>
        <p className="text-xs text-muted-foreground">{new Date(s.startDate).toLocaleDateString()} – {new Date(s.endDate).toLocaleDateString()}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between text-sm"><span>{r.label}</span><span>{r.value}</span></div>
        ))}
        <div className="flex justify-between border-t pt-2 text-sm font-semibold"><span>Net cash flow</span><span>{formatMoney(s.netCashFlow)}</span></div>
        <div className="flex justify-between text-xs text-muted-foreground"><span>Beginning cash</span><span>{formatMoney(s.beginningCash)}</span></div>
        <div className="flex justify-between text-xs text-muted-foreground"><span>Ending cash</span><span>{formatMoney(s.endingCash)}</span></div>
        <span className={`inline-block rounded px-2 py-1 text-xs ${s.isReconciled ? 'bg-secondary text-secondary-foreground' : 'bg-destructive/15 text-destructive'}`}>
          {s.isReconciled ? 'Reconciled' : 'Not reconciled'}
        </span>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

function AccountsSection({ accounts, onChange }: { accounts: Account[]; onChange: () => void }) {
  const [newAccount, setNewAccount] = useState({ code: '', name: '', type: 'EXPENSE', description: '' });
  const [busyError, setBusyError] = useState<string | null>(null);

  async function createAccount() {
    setBusyError(null);
    const res = await fetch('/api/finance/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newAccount, description: newAccount.description || undefined }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to create account.'); return; }
    setNewAccount({ code: '', name: '', type: 'EXPENSE', description: '' });
    onChange();
  }

  async function toggleActive(account: Account) {
    setBusyError(null);
    const res = await fetch(`/api/finance/accounts/${account.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !account.active }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to update account.'); return; }
    onChange();
  }

  const byType = ACCOUNT_TYPES.map((type) => ({ type, accounts: accounts.filter((a) => a.type === type) }));

  return (
    <div className="space-y-4">
      {busyError && <p className="text-sm text-destructive">{busyError}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Chart of accounts</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {byType.map(({ type, accounts: typeAccounts }) =>
            typeAccounts.length === 0 ? null : (
              <div key={type} className="space-y-1">
                <p className="text-xs font-semibold uppercase text-muted-foreground">{type}</p>
                <table className="w-full text-sm">
                  <tbody>
                    {typeAccounts.map((a) => (
                      <tr key={a.id} className={`border-b last:border-0 ${a.active ? '' : 'opacity-50'}`}>
                        <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">{a.code}</td>
                        <td className="py-1.5 pr-3">{a.name}{a.isSystem && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">system</span>}</td>
                        <td className="py-1.5 pr-3 text-xs text-muted-foreground">{a.normalBalance}</td>
                        <td className="py-1.5 text-right">
                          <Button size="sm" variant="outline" onClick={() => toggleActive(a)}>{a.active ? 'Deactivate' : 'Activate'}</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Add a custom account</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">Code</Label>
            <Input className="h-9 w-24" value={newAccount.code} onChange={(e) => setNewAccount((p) => ({ ...p, code: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Name</Label>
            <Input className="h-9 w-48" value={newAccount.name} onChange={(e) => setNewAccount((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={newAccount.type}
              onChange={(e) => setNewAccount((p) => ({ ...p, type: e.target.value }))}
            >
              {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <Label className="text-xs">Description</Label>
            <Input className="h-9" value={newAccount.description} onChange={(e) => setNewAccount((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <Button size="sm" onClick={createAccount} disabled={!newAccount.code || !newAccount.name}>Add account</Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Journal entries
// ---------------------------------------------------------------------------

interface DraftLine {
  accountId: string;
  debit: string;
  credit: string;
  description: string;
}

function JournalSection({
  accounts, journalEntries, branches, branchId, onChange,
}: {
  accounts: Account[]; journalEntries: JournalEntry[]; branches: Branch[]; branchId: string; onChange: () => void;
}) {
  const [entryBranchId, setEntryBranchId] = useState(branchId);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { accountId: '', debit: '', credit: '', description: '' },
    { accountId: '', debit: '', credit: '', description: '' },
  ]);
  const [reverseReasons, setReverseReasons] = useState<Record<string, string>>({});
  const [busyError, setBusyError] = useState<string | null>(null);

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { accountId: '', debit: '', credit: '', description: '' }]);
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  const debitTotal = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const creditTotal = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);

  async function createEntry() {
    setBusyError(null);
    const res = await fetch('/api/finance/journal-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branchId: entryBranchId || undefined,
        entryDate,
        description,
        lines: lines
          .filter((l) => l.accountId && (l.debit || l.credit))
          .map((l) => ({ accountId: l.accountId, debit: l.debit || '0', credit: l.credit || '0', description: l.description || undefined })),
      }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to create journal entry.'); return; }
    setDescription('');
    setLines([
      { accountId: '', debit: '', credit: '', description: '' },
      { accountId: '', debit: '', credit: '', description: '' },
    ]);
    onChange();
  }

  async function postEntry(entryId: string) {
    setBusyError(null);
    const res = await fetch(`/api/finance/journal-entries/${entryId}/post`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to post journal entry.'); return; }
    onChange();
  }

  async function reverseEntry(entryId: string) {
    const reason = reverseReasons[entryId];
    if (!reason) { setBusyError('A reason is required to reverse an entry.'); return; }
    setBusyError(null);
    const res = await fetch(`/api/finance/journal-entries/${entryId}/reverse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to reverse journal entry.'); return; }
    setReverseReasons((prev) => ({ ...prev, [entryId]: '' }));
    onChange();
  }

  const activeAccounts = accounts.filter((a) => a.active);

  return (
    <div className="space-y-4">
      {busyError && <p className="text-sm text-destructive">{busyError}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Journal entries</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {journalEntries.length === 0 && <p className="text-sm text-muted-foreground">No journal entries yet.</p>}
          {journalEntries.map((entry) => (
            <div key={entry.id} className="rounded-md border p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{entry.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(entry.entryDate).toLocaleDateString()}
                    {entry.referenceType ? ` · ${entry.referenceType} ${entry.referenceId}` : ''}
                  </p>
                </div>
                <span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_BADGE[entry.status]}`}>{entry.status}</span>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {entry.lines.map((line) => (
                    <tr key={line.id} className="border-b last:border-0">
                      <td className="py-1 pr-3">{line.account.code} {line.account.name}</td>
                      <td className="py-1 pr-3 text-right">{Number(line.debit) > 0 ? line.debit : ''}</td>
                      <td className="py-1 text-right">{Number(line.credit) > 0 ? line.credit : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {entry.status === 'DRAFT' && (
                <Button size="sm" variant="outline" onClick={() => postEntry(entry.id)}>Post</Button>
              )}
              {entry.status === 'POSTED' && (
                <div className="flex flex-wrap items-end gap-2">
                  <Input
                    className="h-8 flex-1 min-w-[160px]"
                    placeholder="Reason for reversal"
                    value={reverseReasons[entry.id] ?? ''}
                    onChange={(e) => setReverseReasons((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                  />
                  <Button size="sm" variant="outline" onClick={() => reverseEntry(entry.id)}>Reverse</Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">New manual journal entry</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Branch (optional)</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={entryBranchId}
                onChange={(e) => setEntryBranchId(e.target.value)}
              >
                <option value="">— org-wide —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" className="h-9" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs">Description</Label>
              <Input className="h-9" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            {lines.map((line, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <select
                  className="h-9 min-w-[220px] rounded-md border border-input bg-background px-2 text-sm"
                  value={line.accountId}
                  onChange={(e) => updateLine(i, { accountId: e.target.value })}
                >
                  <option value="">Select account…</option>
                  {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                </select>
                <div>
                  <Label className="text-xs">Debit</Label>
                  <Input className="h-9 w-28" value={line.debit} onChange={(e) => updateLine(i, { debit: e.target.value, credit: e.target.value ? '' : line.credit })} />
                </div>
                <div>
                  <Label className="text-xs">Credit</Label>
                  <Input className="h-9 w-28" value={line.credit} onChange={(e) => updateLine(i, { credit: e.target.value, debit: e.target.value ? '' : line.debit })} />
                </div>
                <Input className="h-9 flex-1 min-w-[140px]" placeholder="Line description" value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
                {lines.length > 2 && <Button size="sm" variant="outline" onClick={() => removeLine(i)}>Remove</Button>}
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button size="sm" variant="outline" onClick={addLine}>Add line</Button>
              <p className={`text-xs ${debitTotal === creditTotal && debitTotal > 0 ? 'text-secondary-foreground' : 'text-destructive'}`}>
                Debits {debitTotal.toFixed(2)} / Credits {creditTotal.toFixed(2)}
              </p>
            </div>
          </div>

          <Button size="sm" onClick={createEntry} disabled={!description || debitTotal !== creditTotal || debitTotal === 0}>
            Create draft entry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------

function TrialBalanceSection() {
  const [asOfDate, setAsOfDate] = useState('');
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null);
  const [busyError, setBusyError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setBusyError(null);
    const qs = asOfDate ? `?asOfDate=${asOfDate}` : '';
    const res = await fetch(`/api/finance/trial-balance${qs}`);
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to generate trial balance.'); return; }
    setTrialBalance(data.trialBalance);
  }, [asOfDate]);

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      {busyError && <p className="text-sm text-destructive">{busyError}</p>}
      <Card>
        <CardHeader><CardTitle className="text-base">Trial balance</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">As of date (optional)</Label>
              <Input type="date" className="h-9" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
            </div>
            <Button size="sm" variant="outline" onClick={generate}>Generate</Button>
          </div>

          {trialBalance && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1.5 font-medium">Account</th>
                    <th className="py-1.5 text-right font-medium">Debit</th>
                    <th className="py-1.5 text-right font-medium">Credit</th>
                    <th className="py-1.5 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {trialBalance.accounts.map((row) => (
                    <tr key={row.accountId} className="border-b last:border-0">
                      <td className="py-1.5">{row.code} {row.name}</td>
                      <td className="py-1.5 text-right">{Number(row.debit) > 0 ? row.debit : ''}</td>
                      <td className="py-1.5 text-right">{Number(row.credit) > 0 ? row.credit : ''}</td>
                      <td className="py-1.5 text-right font-medium">{row.balance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
                <span>Totals: Debits {trialBalance.totalDebits} / Credits {trialBalance.totalCredits}</span>
                <span className={`rounded px-2 py-1 text-xs ${trialBalance.isBalanced ? 'bg-secondary text-secondary-foreground' : 'bg-destructive/15 text-destructive'}`}>
                  {trialBalance.isBalanced ? 'Balanced' : 'Out of balance'}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accounting periods
// ---------------------------------------------------------------------------

function PeriodsSection({ periods, onChange }: { periods: Period[]; onChange: () => void }) {
  const [busyError, setBusyError] = useState<string | null>(null);

  async function closePeriod(periodId: string) {
    setBusyError(null);
    const res = await fetch(`/api/finance/periods/${periodId}/close`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to close period.'); return; }
    onChange();
  }

  return (
    <div className="space-y-4">
      {busyError && <p className="text-sm text-destructive">{busyError}</p>}
      <Card>
        <CardHeader><CardTitle className="text-base">Accounting periods</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {periods.length === 0 && <p className="text-sm text-muted-foreground">No periods yet — one is created automatically the first time an entry posts into a given month.</p>}
          {periods.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <p className="text-sm">
                {new Date(p.startDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
              </p>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_BADGE[p.status]}`}>{p.status}</span>
                {p.status === 'OPEN' && <Button size="sm" variant="outline" onClick={() => closePeriod(p.id)}>Close period</Button>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vendors / expense categories / expenses
// ---------------------------------------------------------------------------

function ExpensesSection({
  branchId, branches, expenses, vendors, categories, accounts, onChange,
}: {
  branchId: string; branches: Branch[]; expenses: Expense[]; vendors: Vendor[]; categories: ExpenseCategory[]; accounts: Account[]; onChange: () => void;
}) {
  const [newVendor, setNewVendor] = useState({ name: '', contactName: '', email: '', phone: '' });
  const [newCategory, setNewCategory] = useState({ name: '', defaultAccountId: '' });
  const [newExpense, setNewExpense] = useState({
    vendorId: '', categoryId: '', amount: '', expenseDate: new Date().toISOString().slice(0, 10), paymentMethod: 'CASH', notes: '',
  });
  const [busyError, setBusyError] = useState<string | null>(null);

  async function createVendor() {
    setBusyError(null);
    const res = await fetch('/api/finance/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newVendor.name,
        contactName: newVendor.contactName || undefined,
        email: newVendor.email || undefined,
        phone: newVendor.phone || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to create vendor.'); return; }
    setNewVendor({ name: '', contactName: '', email: '', phone: '' });
    onChange();
  }

  async function createCategory() {
    setBusyError(null);
    const res = await fetch('/api/finance/expense-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newCategory.name, defaultAccountId: newCategory.defaultAccountId || undefined }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to create expense category.'); return; }
    setNewCategory({ name: '', defaultAccountId: '' });
    onChange();
  }

  async function createExpense() {
    if (!branchId) { setBusyError('Select a branch first.'); return; }
    setBusyError(null);
    const res = await fetch(`/api/branches/${branchId}/finance/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendorId: newExpense.vendorId || undefined,
        categoryId: newExpense.categoryId,
        amount: newExpense.amount,
        expenseDate: newExpense.expenseDate,
        paymentMethod: newExpense.paymentMethod,
        notes: newExpense.notes || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to create expense.'); return; }
    setNewExpense({ vendorId: '', categoryId: '', amount: '', expenseDate: new Date().toISOString().slice(0, 10), paymentMethod: 'CASH', notes: '' });
    onChange();
  }

  async function approveExpense(expenseId: string) {
    if (!branchId) return;
    setBusyError(null);
    const res = await fetch(`/api/branches/${branchId}/finance/expenses/${expenseId}/approve`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to approve expense.'); return; }
    onChange();
  }

  async function rejectExpense(expenseId: string) {
    if (!branchId) return;
    const reason = window.prompt('Reason for rejecting this expense?');
    if (!reason) return;
    setBusyError(null);
    const res = await fetch(`/api/branches/${branchId}/finance/expenses/${expenseId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to reject expense.'); return; }
    onChange();
  }

  return (
    <div className="space-y-4">
      {busyError && <p className="text-sm text-destructive">{busyError}</p>}

      {!branchId && (
        <p className="text-sm text-muted-foreground">
          {branches.length === 0 ? 'No branches yet — add one under Settings first.' : 'Select a branch above to view and record expenses.'}
        </p>
      )}

      {branchId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Expenses</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {expenses.length === 0 && <p className="text-sm text-muted-foreground">No expenses recorded at this branch yet.</p>}
            {expenses.map((exp) => (
              <div key={exp.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div>
                  <p className="text-sm font-semibold">{exp.category.name} — ₱{exp.amount}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(exp.expenseDate).toLocaleDateString()} · {exp.paymentMethod}
                    {exp.vendor ? ` · ${exp.vendor.name}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_BADGE[exp.approvalStatus]}`}>{exp.approvalStatus}</span>
                  {exp.approvalStatus === 'PENDING' && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => approveExpense(exp.id)}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => rejectExpense(exp.id)}>Reject</Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {branchId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Record an expense</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Category</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={newExpense.categoryId}
                onChange={(e) => setNewExpense((p) => ({ ...p, categoryId: e.target.value }))}
              >
                <option value="">Select…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Vendor (optional)</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={newExpense.vendorId}
                onChange={(e) => setNewExpense((p) => ({ ...p, vendorId: e.target.value }))}
              >
                <option value="">— none —</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Amount</Label>
              <Input className="h-9 w-28" value={newExpense.amount} onChange={(e) => setNewExpense((p) => ({ ...p, amount: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" className="h-9" value={newExpense.expenseDate} onChange={(e) => setNewExpense((p) => ({ ...p, expenseDate: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Payment method</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={newExpense.paymentMethod}
                onChange={(e) => setNewExpense((p) => ({ ...p, paymentMethod: e.target.value }))}
              >
                {EXPENSE_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <Label className="text-xs">Notes</Label>
              <Input className="h-9" value={newExpense.notes} onChange={(e) => setNewExpense((p) => ({ ...p, notes: e.target.value }))} />
            </div>
            <Button size="sm" onClick={createExpense} disabled={!newExpense.categoryId || !newExpense.amount}>Record expense</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Vendors</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {vendors.length === 0 && <p className="text-sm text-muted-foreground">No vendors yet.</p>}
          {vendors.map((v) => (
            <div key={v.id} className="text-sm">{v.name}{v.contactName ? ` — ${v.contactName}` : ''}</div>
          ))}
          <div className="flex flex-wrap items-end gap-2 pt-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input className="h-9" value={newVendor.name} onChange={(e) => setNewVendor((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Contact</Label>
              <Input className="h-9" value={newVendor.contactName} onChange={(e) => setNewVendor((p) => ({ ...p, contactName: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input className="h-9" value={newVendor.email} onChange={(e) => setNewVendor((p) => ({ ...p, email: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input className="h-9" value={newVendor.phone} onChange={(e) => setNewVendor((p) => ({ ...p, phone: e.target.value }))} />
            </div>
            <Button size="sm" variant="outline" onClick={createVendor} disabled={!newVendor.name}>Add vendor</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Expense categories</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {categories.length === 0 && <p className="text-sm text-muted-foreground">No expense categories yet.</p>}
          {categories.map((c) => (
            <div key={c.id} className="text-sm">
              {c.name}{c.defaultAccount ? ` → ${c.defaultAccount.code} ${c.defaultAccount.name}` : ' (no default account — cannot be approved until one is set)'}
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-2 pt-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input className="h-9" value={newCategory.name} onChange={(e) => setNewCategory((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Default account</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={newCategory.defaultAccountId}
                onChange={(e) => setNewCategory((p) => ({ ...p, defaultAccountId: e.target.value }))}
              >
                <option value="">— none —</option>
                {accounts.filter((a) => a.type === 'EXPENSE' && a.active).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </select>
            </div>
            <Button size="sm" variant="outline" onClick={createCategory} disabled={!newCategory.name}>Add category</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
