'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';

interface Branch {
  id: string;
  name: string;
}
interface InvoiceItemRow {
  id: string;
  nameSnapshot: string;
  unitPriceSnapshot: string;
  quantity: number;
  lineTotal: string;
  modifiersSummary: string | null;
}
interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  total: string;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  items: InvoiceItemRow[];
}

export function InvoiceBoard({ branches }: { branches: Branch[] }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<Record<string, string>>({});

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/branches/${id}/invoices`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load invoices.');
      setInvoices(data.invoices);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(branchId);
  }, [branchId, load]);

  async function voidInvoice(invoiceId: string, reason: string) {
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/invoices/${invoiceId}/void`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not void invoice.');
      return;
    }
    setVoiding((v) => {
      const next = { ...v };
      delete next[invoiceId];
      return next;
    });
    load(branchId);
  }

  if (branches.length === 0) {
    return <p className="text-sm text-muted-foreground">No branches yet — add one under Settings first.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label htmlFor="invoiceBranchSelect" className="text-sm">
          Branch
        </Label>
        <select
          id="invoiceBranchSelect"
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
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-3">
        {invoices.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">
            No invoices yet — issue one from a fully-paid order on the Orders page.
          </p>
        )}
        {invoices.map((inv) => (
          <Card key={inv.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span>{inv.invoiceNumber}</span>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                    inv.status === 'VOID'
                      ? 'bg-muted text-muted-foreground border-border line-through'
                      : 'bg-success/15 text-success border-success/30',
                  )}
                >
                  {inv.status}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Issued {new Date(inv.issuedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
              <ul className="space-y-1 text-sm">
                {inv.items.map((item) => (
                  <li key={item.id} className="flex justify-between text-muted-foreground">
                    <span>
                      {item.quantity}× {item.nameSnapshot}
                      {item.modifiersSummary && <span className="text-xs"> ({item.modifiersSummary})</span>}
                    </span>
                    <span>₱{item.lineTotal}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between border-t pt-2 text-sm">
                <span className="text-muted-foreground">
                  Subtotal ₱{inv.subtotal} · Tax ₱{inv.taxTotal}
                  {Number(inv.discountTotal) > 0 && ` · Discount -₱${inv.discountTotal}`}
                </span>
                <span className="font-medium">Total ₱{inv.total}</span>
              </div>
              {inv.voidReason && <p className="text-xs text-destructive">Voided: {inv.voidReason}</p>}

              {inv.status === 'ISSUED' &&
                (voiding[inv.id] !== undefined ? (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    <Input
                      placeholder="Reason for voiding"
                      className="max-w-xs"
                      value={voiding[inv.id]}
                      onChange={(e) => setVoiding((v) => ({ ...v, [inv.id]: e.target.value }))}
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!voiding[inv.id]?.trim()}
                      onClick={() => {
  const reason = voiding[inv.id];
  if (reason?.trim()) {
    voidInvoice(inv.id, reason);
  }
}}
                    >
                      Confirm void
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setVoiding((v) => {
                          const next = { ...v };
                          delete next[inv.id];
                          return next;
                        })
                      }
                    >
                      Back
                    </Button>
                  </div>
                ) : (
                  <div className="border-t pt-3">
                    <Button type="button" size="sm" variant="outline" onClick={() => setVoiding((v) => ({ ...v, [inv.id]: '' }))}>
                      Void
                    </Button>
                  </div>
                ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
