import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { OrganizationService } from '@/services/organizations/OrganizationService';
import { BranchService } from '@/services/branches/BranchService';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BranchForm } from './branch-form';
import { BusinessHoursEditor } from './business-hours-editor';

export default async function SettingsPage() {
  const session = requireAuthenticated(await getSession());
  const [organization, branches] = await Promise.all([
    OrganizationService.get(session.organizationId),
    BranchService.list(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Organization &amp; branch management (Phase 1/2).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization</CardTitle>
          <CardDescription>{organization.email}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Name</p>
            <p className="font-medium">{organization.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Currency</p>
            <p className="font-medium">{organization.currency}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Timezone</p>
            <p className="font-medium">{organization.timezone}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Created</p>
            <p className="font-medium">{organization.createdAt.toDateString()}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Branches</CardTitle>
          <CardDescription>
            Tables and menu are managed on their own pages. Business hours are set here, per
            branch.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y rounded-md border">
            {branches.length === 0 && (
              <li className="p-3 text-sm text-muted-foreground">No branches yet.</li>
            )}
            {branches.map((b) => (
              <li key={b.id} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-muted-foreground">{b.address || '—'}</span>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">{b.status}</span>
                </div>
                <BusinessHoursEditor
                  branchId={b.id}
                  initialHours={b.openingHours as Record<string, { open: string; close: string; closed: boolean }> | null}
                />
              </li>
            ))}
          </ul>
          <BranchForm />
        </CardContent>
      </Card>
    </div>
  );
}
