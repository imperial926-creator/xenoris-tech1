'use client';

import { useCallback, useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';

interface Branch {
  id: string;
  name: string;
}

interface NotificationRow {
  id: string;
  type: string;
  channel: 'EMAIL' | 'SMS' | 'PUSH';
  status: 'SENT' | 'FAILED' | 'SKIPPED_NOT_CONFIGURED' | 'SKIPPED_NO_RECIPIENT';
  recipient: string | null;
  subject: string | null;
  body: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
}

const NOTIFICATION_TYPES = [
  'RESERVATION_CONFIRMATION',
  'RESERVATION_REMINDER',
  'DEPOSIT_REMINDER',
  'ORDER_CONFIRMATION',
  'ORDER_STATUS',
  'DELIVERY_UPDATE',
  'CATERING_QUOTATION',
  'CATERING_REMINDER',
  'PAYMENT_REMINDER',
  'INVOICE',
  'REVIEW_REQUEST',
  'CATERING_INQUIRY_RECEIVED',
] as const;

const STATUS_STYLE: Record<NotificationRow['status'], string> = {
  SENT: 'bg-success/15 text-success border-success/30',
  FAILED: 'bg-destructive/15 text-destructive border-destructive/30',
  SKIPPED_NOT_CONFIGURED: 'bg-muted text-muted-foreground border-border',
  SKIPPED_NO_RECIPIENT: 'bg-muted text-muted-foreground border-border',
};

export function NotificationsBoard({ branches }: { branches: Branch[] }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string, typeFilter: string, statusFilter: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set('type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/branches/${id}/notifications?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load notifications.');
      setNotifications(data.notifications);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(branchId, type, status);
  }, [branchId, type, status, load]);

  if (branches.length === 0) {
    return <p className="text-sm text-muted-foreground">No branches yet — add one under Settings first.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="notifBranchSelect" className="text-xs">
            Branch
          </Label>
          <select
            id="notifBranchSelect"
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
        </div>
        <div>
          <Label htmlFor="notifTypeSelect" className="text-xs">
            Type
          </Label>
          <select
            id="notifTypeSelect"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">All types</option>
            {NOTIFICATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="notifStatusSelect" className="text-xs">
            Status
          </Label>
          <select
            id="notifStatusSelect"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="SENT">Sent</option>
            <option value="FAILED">Failed</option>
            <option value="SKIPPED_NOT_CONFIGURED">Skipped — not configured</option>
            <option value="SKIPPED_NO_RECIPIENT">Skipped — no recipient</option>
          </select>
        </div>
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        {notifications.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">
            No notifications match these filters. Notifications are recorded as a side effect of reservations, orders,
            deliveries, catering, and invoices — see docs/architecture.md § Phase 14.
          </p>
        )}
        {notifications.map((n) => (
          <Card key={n.id}>
            <CardContent className="space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', STATUS_STYLE[n.status])}>
                  {n.status.replace(/_/g, ' ')}
                </span>
                <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{n.channel}</span>
                <span className="text-sm font-medium">{n.type.replace(/_/g, ' ')}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                To {n.recipient ?? '(no recipient on file)'} · {n.relatedEntityType} {n.relatedEntityId}
              </p>
              {n.subject && <p className="text-sm font-medium">{n.subject}</p>}
              <p className="text-sm text-muted-foreground">{n.body}</p>
              {n.errorMessage && <p className="text-xs text-destructive">Error: {n.errorMessage}</p>}
              <p className="text-[10px] text-muted-foreground">
                {new Date(n.createdAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
