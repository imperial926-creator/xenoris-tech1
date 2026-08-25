'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';

interface Branch {
  id: string;
  name: string;
}
interface ModifierRow {
  nameSnapshot: string;
}
interface ItemRow {
  id: string;
  nameSnapshot: string;
  quantity: number;
  notes: string | null;
  modifiers: ModifierRow[];
}
interface Ticket {
  id: string;
  type: string;
  status: string;
  tableId: string | null;
  table: { tableNumber: string } | null;
  notes: string | null;
  requiredAt: string | null;
  createdAt: string;
  items: ItemRow[];
}

// Kitchen-facing labels for the spec's NEW/ACCEPTED/PREPARING/READY column
// names, mapped onto the underlying OrderStatus values (see the
// "Phase 5 — Kitchen Display System" comment in schema.prisma for why these
// are the same state machine, not a parallel one).
const COLUMNS: { status: string; label: string }[] = [
  { status: 'PENDING', label: 'New' },
  { status: 'CONFIRMED', label: 'Accepted' },
  { status: 'PREPARING', label: 'Preparing' },
  { status: 'READY', label: 'Ready' },
];

const ADVANCE_ACTION_LABEL: Record<string, string> = {
  PENDING: 'Accept',
  CONFIRMED: 'Start preparing',
  PREPARING: 'Mark ready',
};

// Practical stand-in for real-time push: this build has no WebSocket/Pusher
// infra configured (same "no fake integrations" rule as payments/email/SMS —
// see CLAUDE.md -> Deployment Rules), so the board polls on an interval
// instead. Short enough to feel live on a kitchen line, long enough not to
// hammer the API.
const POLL_INTERVAL_MS = 7000;

function elapsedLabel(createdAt: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min';
  return `${minutes} min`;
}

function isOverdue(requiredAt: string | null) {
  if (!requiredAt) return false;
  return new Date(requiredAt).getTime() < Date.now();
}

export function KitchenBoard({ branches }: { branches: Branch[] }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/branches/${id}/kitchen/queue`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load the kitchen queue.');
      setTickets(data.orders);
      setError(null);
      setLastRefreshed(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }, []);

  useEffect(() => {
    load(branchId);
    const interval = setInterval(() => load(branchId), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [branchId, load]);

  async function advance(orderId: string) {
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/kitchen/orders/${orderId}/advance`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not advance this ticket.');
      return;
    }
    load(branchId);
  }

  if (branches.length === 0) {
    return <p className="text-sm text-muted-foreground">No branches yet — add one under Settings first.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="kitchenBranchSelect" className="text-sm">
          Branch
        </Label>
        <select
          id="kitchenBranchSelect"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {lastRefreshed
            ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · refreshes automatically`
            : 'Loading…'}
        </span>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const columnTickets = tickets.filter((t: Ticket) => t.status === col.status);
          return (
            <div key={col.status} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {col.label}
                </h2>
                <span className="text-xs text-muted-foreground">{columnTickets.length}</span>
              </div>
              <div className="space-y-3">
                {columnTickets.length === 0 && (
                  <p className="text-xs text-muted-foreground">No tickets.</p>
                )}
                {columnTickets.map((ticket: Ticket) => {
                  const overdue = isOverdue(ticket.requiredAt);
                  const actionLabel = ADVANCE_ACTION_LABEL[ticket.status];
                  return (
                    <Card key={ticket.id} className={cn('border-2', overdue ? 'border-destructive' : 'border-border')}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-sm font-semibold">
                            #{ticket.id.slice(-6).toUpperCase()}
                          </CardTitle>
                          <span className="text-xs text-muted-foreground">{elapsedLabel(ticket.createdAt)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{ticket.type.replace(/_/g, ' ')}</span>
                          {ticket.table && <span>· Table {ticket.table.tableNumber}</span>}
                          {ticket.requiredAt && (
                            <span className={overdue ? 'font-semibold text-destructive' : ''}>
                              · Needed by{' '}
                              {new Date(ticket.requiredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {overdue ? ' (overdue)' : ''}
                            </span>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <ul className="space-y-1 text-sm">
                          {ticket.items.map((item) => (
                            <li key={item.id}>
                              <span className="font-medium">{item.quantity}× </span>
                              {item.nameSnapshot}
                              {item.modifiers.length > 0 && (
                                <div className="pl-4 text-xs text-muted-foreground">
                                  {item.modifiers.map((m) => m.nameSnapshot).join(', ')}
                                </div>
                              )}
                              {item.notes && (
                                <div className="pl-4 text-xs italic text-muted-foreground">{item.notes}</div>
                              )}
                            </li>
                          ))}
                        </ul>
                        {ticket.notes && (
                          <p className="rounded border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
                            {ticket.notes}
                          </p>
                        )}
                        {actionLabel && (
                          <Button size="sm" className="w-full" onClick={() => advance(ticket.id)}>
                            {actionLabel}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
