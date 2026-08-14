import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { BranchService } from '@/services/branches/BranchService';
import { MenuService } from '@/services/menu/MenuService';
import { prisma } from '@/lib/db/prisma';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const PLACEHOLDER_CARDS = [
  { title: "Today's Revenue", phase: 11, note: 'Requires the accounting ledger (Phase 10) and financial dashboard (Phase 11).' },
  { title: 'Inventory Alerts', phase: 9, note: 'Requires inventory tracking.' },
  { title: 'AI Business Insights', phase: 13, note: 'Read-only analytics layer, built once real data exists.' },
];

export default async function DashboardOverviewPage() {
  const session = requireAuthenticated(await getSession());
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const [branches, menuItems, tableCount, reservationsToday, ordersToday, kitchenQueueCount] = await Promise.all([
    BranchService.list(session.organizationId),
    MenuService.listItems(session.organizationId),
    prisma.restaurantTable.count({ where: { organizationId: session.organizationId } }),
    prisma.reservation.count({
      where: {
        organizationId: session.organizationId,
        startAt: { gte: startOfToday, lt: startOfTomorrow },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
    }),
    prisma.order.count({
      where: {
        organizationId: session.organizationId,
        createdAt: { gte: startOfToday, lt: startOfTomorrow },
        status: { not: 'CANCELLED' },
      },
    }),
    prisma.order.count({
      where: {
        organizationId: session.organizationId,
        status: { in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'] },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Business Overview</h1>
        <p className="text-sm text-muted-foreground">
          Phase 1 (foundation), Phase 2 (tables &amp; menu), Phase 3 (reservations), Phase 4
          (orders, payments &amp; invoicing), and Phase 5 (kitchen display) are live. Operational
          and financial modules below activate as each phase ships — see{' '}
          <code className="text-xs">CLAUDE.md</code> for status.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Branches</CardTitle>
            <CardDescription>Live data — organizations &amp; branches module (Phase 1)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{branches.length}</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {branches.length === 0 && <li>No branches yet — add one to get started.</li>}
              {branches.map((b) => (
                <li key={b.id}>
                  {b.name} — {b.status}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tables &amp; Menu</CardTitle>
            <CardDescription>Live data — restaurant configuration module (Phase 2)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-3xl font-semibold">{tableCount}</p>
            <p className="text-sm text-muted-foreground">tables configured</p>
            <p className="pt-2 text-sm text-muted-foreground">{menuItems.length} menu items</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reservations Today</CardTitle>
            <CardDescription>Live data — reservations module (Phase 3)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{reservationsToday}</p>
            <p className="text-sm text-muted-foreground">excluding cancelled / no-show</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Orders Today</CardTitle>
            <CardDescription>Live data — orders &amp; invoicing module (Phase 4)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{ordersToday}</p>
            <p className="text-sm text-muted-foreground">excluding cancelled</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kitchen Queue</CardTitle>
            <CardDescription>Live data — kitchen display system (Phase 5)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{kitchenQueueCount}</p>
            <p className="text-sm text-muted-foreground">tickets from new through ready</p>
          </CardContent>
        </Card>

        {PLACEHOLDER_CARDS.map((card) => (
          <Card key={card.title} className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base text-muted-foreground">{card.title}</CardTitle>
              <CardDescription>Coming in Phase {card.phase}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{card.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
