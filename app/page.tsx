import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';

// Root route is a pure traffic director: signed-in staff go to the
// dashboard, everyone else goes to login. The public customer-facing site
// (app/(customer)/home) is built out starting Phase 2.
export default async function RootPage() {
  const session = await getSession();
  redirect(session ? '/dashboard' : '/login');
}
