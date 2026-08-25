import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { AuthService } from '@/services/auth/AuthService';
import { DashboardNav } from '@/components/layout/dashboard-nav';
import { LogoutButton } from '@/components/layout/logout-button';

// Belt-and-suspenders: middleware.ts already redirects unauthenticated
// requests to /login before this renders, but this layout re-checks and
// loads the real user record so the UI never trusts the JWT's denormalized
// claims for anything beyond routing.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const user = await AuthService.getSessionUser(session);

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr]">
      <aside className="border-r bg-muted/20">
        <div className="border-b px-4 py-4">
          <p className="text-sm font-semibold">{user.organization.name}</p>
          <p className="text-xs text-muted-foreground">
            {user.organization.currency} · {user.organization.timezone}
          </p>
        </div>
        <DashboardNav />
      </aside>
      <div className="flex flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <div>
            <p className="text-sm font-medium">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-xs text-muted-foreground">
              {user.roles.map((r) => r.name).join(', ') || 'No role assigned'}
            </p>
          </div>
          <LogoutButton />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
