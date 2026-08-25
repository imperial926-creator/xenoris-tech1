'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Payment {
  id: string;
  organizationId: string;
  organization: { name: string };
  amount: string;
  currency: string;
  status: string;
  providerTransactionId: string | null;
  createdAt: string;
  invoice: { invoiceNumber: string } | null;
}

// Master spec §49 (search) and §39 (refunds, issued right from a search
// result — the workflow a real reconciliation task actually needs).
export default function PlatformAdminPaymentsPage() {
  const [q, setQ] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [refundReason, setRefundReason] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const res = await fetch(`/api/platform-admin/payments?transactionId=${encodeURIComponent(q)}&invoiceNumber=${encodeURIComponent(q)}`);
    const data = await res.json();
    setPayments(data.payments ?? []);
  }

  async function refund(paymentId: string) {
    const reason = refundReason[paymentId];
    if (!reason) {
      setError('Enter a refund reason first.');
      return;
    }
    setError(null);
    const res = await fetch('/api/platform-admin/refunds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId, reason }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Refund failed.');
      return;
    }
    search();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
        <p className="text-sm text-muted-foreground">Search by invoice number or transaction reference.</p>
      </div>

      <Card>
        <CardContent className="flex gap-2 pt-6">
          <Input placeholder="Invoice # or transaction ID" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button onClick={search}>Search</Button>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {payments.length === 0 && <p className="text-sm text-muted-foreground">No results.</p>}
          {payments.map((p) => (
            <div key={p.id} className="rounded-md border p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{p.organization.name}</span>
                <span>
                  {p.currency} {p.amount} — {p.status}
                </span>
              </div>
              <p className="text-muted-foreground">
                {p.invoice?.invoiceNumber ?? '—'} · {p.providerTransactionId ?? '—'} ·{' '}
                {new Date(p.createdAt).toLocaleString()}
              </p>
              {p.status === 'SUCCEEDED' && (
                <div className="mt-2 flex gap-2">
                  <Input
                    placeholder="Refund reason"
                    value={refundReason[p.id] ?? ''}
                    onChange={(e) => setRefundReason({ ...refundReason, [p.id]: e.target.value })}
                  />
                  <Button variant="destructive" size="sm" onClick={() => refund(p.id)}>
                    Refund
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
