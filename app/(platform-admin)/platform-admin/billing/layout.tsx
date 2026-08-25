import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getPlatformAdminSession } from '@/lib/platform-admin/session';
import { PlatformAdminLogoutButton } from '@/components/billing/platform-admin-logout-button';

// Scoped to /platform-admin/billing/** only (NOT /platform-admin/login,
// which sits one level up and must stay reachable while logged out) — see
// this file's location relative to app/(platform-admin)/platform-admin/login/page.tsx.
// Belt-and-suspenders re-check, same "middleware is UX, this is real"
// relationship as app/dashboard/layout.tsx has with its own middleware
// gate.
const NAV_ITEMS = [
  { href: '/platform-admin/billing', label: 'Configuration' },
  { href: '/platform-admin/billing/plans', label: 'Subscription Plans' },
  { href: '/platform-admin/billing/payments', label: 'Payments' },
  { href: '/platform-admin/billing/action-center', label: 'Action Center' },
  { href: '/platform-admin/billing/analytics', label: 'Analytics' },
  { href: '/platform-admin/billing/sms', label: 'SMS Settings' },
];

export default async function PlatformAdminBillingLayout({ children }: { children: React.ReactNode }) {
  const session = await getPlatformAdminSession();
  if (!session) redirect('/platform-admin/login');

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-slate-50">
      <aside className="border-r bg-slate-950 text-slate-100">
        <div className="border-b border-slate-800 px-4 py-4">
          <p className="text-sm font-semibold">Platform Administration</p>
          <p className="text-xs text-slate-400">{session.email}</p>
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
