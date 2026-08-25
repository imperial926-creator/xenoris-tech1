import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { requirePlatformAdmin } from '@/lib/platform-admin/guard';
import { PlatformAdminLogoutButton } from '@/components/billing/platform-admin-logout-button';

// Phase 18 — Data Analytics & Business Intelligence + Action Center
// Extension console. A SIBLING shell to `/platform-admin/billing/**`
// (Phase 17), not a replacement — billing configuration/plans/payments
// stay under their own nav, this covers the new analytics/complaints/
// follow-ups/platform-health/reports/admin-management sections. Same
// auth-guard pattern as the billing layout: middleware is UX, this is the
// real re-check.
const NAV_ITEMS = [
  { href: '/platform-admin/console', label: 'Executive Overview' },
  { href: '/platform-admin/console/revenue', label: 'Revenue' },
  { href: '/platform-admin/console/restaurants', label: 'Restaurants & Churn' },
  { href: '/platform-admin/console/app-usage', label: 'App & Feature Usage' },
  { href: '/platform-admin/console/action-center', label: 'Action Center' },
  { href: '/platform-admin/console/follow-ups', label: 'Follow-Ups' },
  { href: '/platform-admin/console/complaints', label: 'Complaints' },
  { href: '/platform-admin/console/platform-health', label: 'Platform Health' },
  { href: '/platform-admin/console/reports', label: 'Custom Reports' },
  { href: '/platform-admin/console/ai-insights', label: 'AI Business Analyst' },
  { href: '/platform-admin/console/admins', label: 'Admin & Roles' },
  { href: '/platform-admin/billing', label: 'Billing (Phase 17) →' },
];

export default async function PlatformAdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatformAdmin(await getPlatformAdminSession()).catch(() => null);
  if (!session) redirect('/platform-admin/login');

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-slate-50">
      <aside className="border-r bg-slate-950 text-slate-100">
        <div className="border-b border-slate-800 px-4 py-4">
          <p className="text-sm font-semibold">Platform Analytics & BI</p>
          <p className="text-xs text-slate-400">
            {session.email} · {session.role}
          </p>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex flex-col">
        <header className="flex items-center justify-end border-b bg-white px-6 py-3">
          <PlatformAdminLogoutButton />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
