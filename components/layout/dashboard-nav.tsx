'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

// Explicit element type (rather than relying on `as const` to infer a
// 15-way union of object literals) is required here: once every item's
// `phase` happened to collapse to just `null | 'unscheduled'` (every
// numbered phase entry having been flipped to `null` as its feature
// shipped), TypeScript's control-flow narrowing on `item.phase ===
// 'unscheduled' ? ... : ...` below would narrow the `Phase ${item.phase}`
// fallback branch to `never` and fail to compile — a real diagnostic, not
// a sandbox artifact. A shared, deliberately-widened `phase` type keeps
// the narrowing correct regardless of which literal values happen to be
// present at any given point in the build (e.g. once Phase 13/14 add
// their own numbered nav entries back).
type NavItem = { href: string; label: string; phase: number | 'unscheduled' | null };

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Overview', phase: null },
  { href: '/dashboard/reservations', label: 'Reservations', phase: null },
  { href: '/dashboard/tables', label: 'Tables', phase: null },
  { href: '/dashboard/menu', label: 'Menu', phase: null },
  { href: '/dashboard/orders', label: 'Orders', phase: null },
  { href: '/dashboard/invoices', label: 'Invoices', phase: null },
  { href: '/dashboard/kitchen', label: 'Kitchen', phase: null },
  { href: '/dashboard/delivery', label: 'Delivery', phase: null },
  { href: '/dashboard/my-deliveries', label: 'My Deliveries', phase: null },
  { href: '/dashboard/catering', label: 'Catering', phase: null },
  { href: '/dashboard/customers', label: 'Customers', phase: null },
  { href: '/dashboard/inventory', label: 'Inventory', phase: null },
  { href: '/dashboard/finance', label: 'Finance', phase: null },
  // Master spec §55 (CSV/PDF/XLSX export of every major report) was never
  // assigned to a specific build phase's own list (checked Phases 10-16
  // explicitly) — the live, on-screen financial reports it would export
  // were built in Phase 11 under Finance -> Reports instead. Flagged
  // "unscheduled" rather than a phase number so this doesn't misleadingly
  // read as "coming soon in a phase already marked done."
  { href: '/dashboard/reports', label: 'Exports', phase: 'unscheduled' },
  { href: '/dashboard/analytics', label: 'Analytics', phase: null },
  { href: '/dashboard/ai-insights', label: 'AI Insights', phase: null },
  { href: '/dashboard/settings', label: 'Settings', phase: null },
];

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <span>{item.label}</span>
            {item.phase && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                {item.phase === 'unscheduled' ? 'Not scheduled' : `Phase ${item.phase}`}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
