import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { BranchService } from '@/services/branches/BranchService';
import { NotificationsBoard } from '@/components/notifications/notifications-board';

export default async function NotificationsPage() {
  const session = requireAuthenticated(await getSession());
  const branches = await BranchService.list(session.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Delivery history for every reservation confirmation, order update, delivery update, catering quotation, and
          invoice notification this platform has attempted to send. Requires Notification View access. No email/SMS
          provider is configured in this build — see docs/architecture.md § Phase 14 — so every attempt currently
          records as &quot;Skipped — not configured&quot; rather than actually being delivered.
        </p>
      </div>
      <NotificationsBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
