'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Plan {
  id: string;
  planCode: string;
  name: string;
  description: string | null;
  monthlyPrice: string;
  billingIntervalMonths: number;
  currency: string;
  status: 'ACTIVE' | 'ARCHIVED';
  displayOrder: number;
}

const BLANK = { planCode: '', name: '', description: '', monthlyPrice: '', billingIntervalMonths: 1, currency: 'PHP', displayOrder: 0 };

// Master spec §7: "The SaaS Owner must be able to edit pricing without
// changing application source code." — this page is that editor.
export default function PlatformAdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    fetch('/api/platform-admin/subscription-plans')
      .then((r) => r.json())
      .then((d) => setPlans(d.plans));
  }

  useEffect(load, []);

  async function createPlan(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/platform-admin/subscription-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, features: [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not create plan.');
      setForm(BLANK);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function archive(planId: string) {
    await fetch(`/api/platform-admin/subscription-plans/${planId}/archive`, { method: 'POST' });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Subscription Plans</h1>
        <p className="text-sm text-muted-foreground">
          What restaurant owners see and select at Subscription Checkout. Archiving a plan removes
          it from new checkouts without affecting existing subscribers.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New plan</CardTitle>
        </CardHeader>
        <form onSubmit={createPlan}>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Plan code</Label>
              <Input required value={form.planCode} onChange={(e) => setForm({ ...form, planCode: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Monthly price (PHP)</Label>
              <Input
                required
                inputMode="decimal"
                value={form.monthlyPrice}
                onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Billing interval (months)</Label>
              <Input
                type="number"
                min={1}
                value={form.billingIntervalMonths}
                onChange={(e) => setForm({ ...form, billingIntervalMonths: Number(e.target.value) })}
              />
            </div>
          </CardContent>
          {error && <p className="px-6 text-sm text-destructive">{error}</p>}
          <CardFooter>
            <Button type="submit" disabled={saving}>
              {saving ? 'Creating…' : 'Create plan'}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All plans</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2">Code</th>
                <th className="py-2">Name</th>
                <th className="py-2">Price</th>
                <th className="py-2">Interval</th>
                <th className="py-2">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-2 font-mono text-xs">{p.planCode}</td>
                  <td className="py-2">{p.name}</td>
                  <td className="py-2">
                    {p.currency} {p.monthlyPrice}
                  </td>
                  <td className="py-2">{p.billingIntervalMonths}mo</td>
                  <td className="py-2">{p.status}</td>
                  <td className="py-2 text-right">
                    {p.status === 'ACTIVE' && (
                      <Button variant="outline" size="sm" onClick={() => archive(p.id)}>
                        Archive
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
