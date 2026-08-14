'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', phase: null },
  { href: '/dashboard/reservations', label: 'Reservations', phase: null },
  { href: '/dashboard/tables', label: 'Tables', phase: null },
  { href: '/dashboard/menu', label: 'Menu', phase: null },
  { href: '/dashboard/orders', label: 'Orders', phase: null },
  { href: '/dashboard/invoices', label: 'Invoices', phase: null },
  { href: '/dashboard/kitchen', label: 'Kitchen', phase: 5 },
  { href: '/dashboard/catering', label: 'Catering', phase: 7 },
  { href: '/dashboard/customers', label: 'Customers', phase: 8 },
  { href: '/dashboard/inventory', label: 'Inventory', phase: 9 },
  { href: '/dashboard/finance', label: 'Finance', phase: 10 },
  { href: '/dashboard/reports', label: 'Reports', phase: 11 },
  { href: '/dashboard/analytics', label: 'Analytics', phase: 12 },
  { href: '/dashboard/settings', label: 'Settings', phase: null },
] as const;

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
                Phase {item.phase}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
