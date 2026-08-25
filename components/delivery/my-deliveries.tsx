'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PaymentRow {
  amount: string;
  status: string;
}
interface DeliveryOrderRow {
  id: string;
  branchId: string;
  status: string;
  order: {
    id: string;
    guestName: string | null;
    guestPhone: string | null;
    deliveryAddress: string | null;
    total: string;
    payments: PaymentRow[];
  };
}

// Master spec §19's driver flow ends in "Navigation" — no maps/geocoding
// provider is configured in this build (see docs/architecture.md § 7
// Risks), so this is a plain deep link into the driver's own maps app
// rather than an integrated turn-by-turn feature.
function mapsLink(address: string) {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}

function paymentStatusLabel(payments: PaymentRow[], total: string) {
  let paid = 0;
  for (const p of payments) {
    const amount = Number(p.amount);
    if (p.status === 'COMPLETED') paid += amount;
    else if (p.status === 'REFUNDED') paid -= amount;
  }
  return paid >= Number(total) ? 'Paid' : `Balance due: ₱${(Number(total) - paid).toFixed(2)}`;
}

const NEXT_ACTION: Record<string, { status: string; label: string } | undefined> = {
  ASSIGNED: { status: 'PICKED_UP', label: 'Mark picked up' },
  PICKED_UP: { status: 'DELIVERED', label: 'Mark delivered' },
};

export function MyDeliveries() {
  const [deliveries, setDeliveries] = useState<DeliveryOrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/deliveries/mine');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load your deliveries.');
      setDeliveries(data.deliveries);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function advance(delivery: DeliveryOrderRow, status: string) {
    setError(null);
    const body: Record<string, string> = { status };
    if (status === 'DELIVERED') {
      body.proofOfDeliveryNote = noteById[delivery.id] ?? '';
    }
    const res = await fetch(`/api/branches/${delivery.branchId}/deliveries/${delivery.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not update this delivery.');
      return;
    }
    load();
  }

  const active = deliveries.filter((d) => d.status === 'ASSIGNED' || d.status === 'PICKED_UP');
  const past = deliveries.filter((d) => d.status !== 'ASSIGNED' && d.status !== 'PICKED_UP');

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Assigned Orders</h2>
        {active.length === 0 && <p className="text-sm text-muted-foreground">No deliveries assigned to you right now.</p>}
        {active.map((d) => {
          const next = NEXT_ACTION[d.status];
          return (
            <Card key={d.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Order #{d.order.id.slice(-6).toUpperCase()}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Customer: {d.order.guestName ?? 'Guest'} {d.order.guestPhone && `· ${d.order.guestPhone}`}</p>
                <p>Address: {d.order.deliveryAddress ?? '—'}</p>
                <p>Order total: ₱{d.order.total}</p>
                <p>Payment status: {paymentStatusLabel(d.order.payments, d.order.total)}</p>
                {d.order.deliveryAddress && (
                  <a
                    className="text-sm text-primary underline"
                    href={mapsLink(d.order.deliveryAddress)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Navigate
                  </a>
                )}
                <p>Delivery status: {d.status.replace(/_/g, ' ')}</p>
                {d.status === 'PICKED_UP' && (
                  <Input
                    placeholder="Proof of delivery note (optional)"
                    className="h-8 text-xs"
                    value={noteById[d.id] ?? ''}
                    onChange={(e) => setNoteById((n) => ({ ...n, [d.id]: e.target.value }))}
                  />
                )}
                {next && (
                  <Button size="sm" onClick={() => advance(d, next.status)}>
                    {next.label}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {past.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">History</h2>
          {past.map((d) => (
            <p key={d.id} className="text-sm text-muted-foreground">
              Order #{d.order.id.slice(-6).toUpperCase()} — {d.status.replace(/_/g, ' ')}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
