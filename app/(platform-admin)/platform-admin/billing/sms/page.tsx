'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Master spec §27-28: SMS Settings + test-send verification gate.
export default function PlatformAdminSmsSettingsPage() {
  const [number, setNumber] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/platform-admin/billing-config')
      .then((r) => r.json())
      .then((d) => {
        setNumber(d.config.smsNotificationNumber ?? '');
        setEnabled(d.config.smsNotificationsEnabled);
      });
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/platform-admin/billing-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smsNotificationNumber: number || undefined, smsNotificationsEnabled: enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTestResult(null);
    setError(null);
    const res = await fetch('/api/platform-admin/sms-test', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Test SMS failed.');
      return;
    }
    setTestResult(data.result?.status === 'sent' ? 'Test SMS sent successfully.' : 'Test SMS attempt failed.');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SMS Settings</h1>
        <p className="text-sm text-muted-foreground">
          Master spec §25: notified after every successful restaurant subscription payment. Never
          shown to restaurant owners.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Notification number</CardTitle>
          <CardDescription>E.164 format, e.g. +639171234567.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="number">Number</Label>
            <Input id="number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+639277736798" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Payment notifications enabled
          </label>
        </CardContent>
        <CardFooter className="gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="outline" onClick={sendTest}>
            Send Test SMS
          </Button>
          {testResult && <span className="text-sm text-green-700">{testResult}</span>}
        </CardFooter>
      </Card>
    </div>
  );
}
