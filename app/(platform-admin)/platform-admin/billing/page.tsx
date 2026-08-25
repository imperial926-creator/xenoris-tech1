'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Config {
  paymentProvider: string | null;
  environment: 'TEST' | 'LIVE';
  connectionStatus: string;
  gatewayConfigured: boolean;
  recurringBillingEnabled: boolean;
  webhookConfigured: boolean;
  lastSuccessfulWebhookAt: string | null;
  lastFailedWebhookAt: string | null;
  settlementBankName: string | null;
  settlementAccountLast4: string | null;
  smsNotificationsEnabled: boolean;
  smsNotificationNumber: string | null;
  gracePeriodDays: number;
  retryIntervalDays: number[];
}

// Master spec §52-53: masked-only settlement display, never a full account
// number — this page's inputs deliberately only ever accept/show the last
// 4 digits (see lib/validation/platform-billing.ts's
// updatePlatformBillingConfigSchema, which rejects anything longer).
export default function PlatformAdminBillingConfigPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/platform-admin/billing-config')
      .then((r) => r.json())
      .then((d) => setConfig(d.config));
  }, []);

  async function save() {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/platform-admin/billing-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environment: config.environment,
          recurringBillingEnabled: config.recurringBillingEnabled,
          settlementBankName: config.settlementBankName ?? undefined,
          settlementAccountLast4: config.settlementAccountLast4 ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed.');
      setConfig(data.config);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  if (!config) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payment Configuration</h1>
        <p className="text-sm text-muted-foreground">
          Master spec §52: never displays full bank account information — masked (last 4 digits) only.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Connection Status</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Payment Gateway</p>
            <p className="font-medium">{config.gatewayConfigured ? 'Connected' : 'Not connected'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Environment</p>
            <p className="font-medium">{config.environment}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Webhook</p>
            <p className="font-medium">{config.webhookConfigured ? 'Receiving events' : 'No events received yet'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Recurring Billing</p>
            <p className="font-medium">{config.recurringBillingEnabled ? 'Enabled' : 'Disabled'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Last Successful Webhook</p>
            <p className="font-medium">
              {config.lastSuccessfulWebhookAt ? new Date(config.lastSuccessfulWebhookAt).toLocaleString() : '—'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Last Failed Webhook</p>
            <p className="font-medium">
              {config.lastFailedWebhookAt ? new Date(config.lastFailedWebhookAt).toLocaleString() : '—'}
            </p>
          </div>
        </CardContent>
        {!config.gatewayConfigured && (
          <CardContent className="pt-0">
            <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No payment gateway is wired in yet. Set SUBSCRIPTION_PAYMENT_PROVIDER_KEY and
              SUBSCRIPTION_PAYMENT_WEBHOOK_SECRET, then register a concrete provider in
              lib/platform-billing/SubscriptionGatewayProvider.ts — see that file&apos;s header.
            </p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settlement (masked)</CardTitle>
          <CardDescription>
            The real receiving account is configured directly at the payment provider&apos;s own
            merchant dashboard — never here. This is display-only, for your own reference.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="bank">Bank name</Label>
            <Input
              id="bank"
              value={config.settlementBankName ?? ''}
              onChange={(e) => setConfig({ ...config, settlementBankName: e.target.value })}
              placeholder="e.g. Metrobank"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last4">Account — last 4 digits</Label>
            <Input
              id="last4"
              maxLength={4}
              value={config.settlementAccountLast4 ?? ''}
              onChange={(e) => setConfig({ ...config, settlementAccountLast4: e.target.value.replace(/\D/g, '') })}
              placeholder="1234"
            />
            {config.settlementAccountLast4 && (
              <p className="text-xs text-muted-foreground">
                Displays as: {config.settlementBankName ?? 'Bank'} ••••••••••••{config.settlementAccountLast4}
              </p>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {saved && <span className="ml-3 text-sm text-green-700">Saved.</span>}
        </CardFooter>
      </Card>
    </div>
  );
}
