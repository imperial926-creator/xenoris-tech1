'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Task {
  id: string;
  type: string;
  status: string;
  priority: string;
  title: string;
  nextFollowUpAt: string | null;
  organization: { id: string; name: string } | null;
}

const OUTCOMES = ['CONTACTED', 'WAITING_FOR_RESPONSE', 'FOLLOW_UP_REQUIRED', 'CONVERTED', 'RESOLVED', 'NOT_INTERESTED', 'NO_RESPONSE', 'CLOSED'];

// Master spec's Follow-Up Management (ADMIN → FOLLOW-UPS): renewals,
// upgrade opportunities, downgrade risk, sales, onboarding, inactive
// accounts, failed payments — a filtered view over the Action Center (see
// FollowUpService's header for the reconciliation).
export default function FollowUpsPage() {
  const [tasks, setTasks] = useState<Task[]>([]);

  const load = useCallback(() => {
    fetch('/api/platform-admin/follow-ups')
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const recordOutcome = async (taskId: string, outcome: string) => {
    await fetch(`/api/platform-admin/follow-ups/${taskId}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    });
    load();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Follow-Ups</h1>

      <Card>
        <CardHeader>
          <CardTitle>Open Follow-Ups</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2">Type</th>
                <th className="py-2">Restaurant</th>
                <th className="py-2">Title</th>
                <th className="py-2">Priority</th>
                <th className="py-2">Next Follow-Up</th>
                <th className="py-2">Record Outcome</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-muted-foreground">
                    No open follow-ups.
                  </td>
                </tr>
              )}
              {tasks.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="py-2 text-xs">{t.type.replace(/_/g, ' ')}</td>
                  <td className="py-2">{t.organization?.name ?? '—'}</td>
                  <td className="py-2">{t.title}</td>
                  <td className="py-2">{t.priority}</td>
                  <td className="py-2">{t.nextFollowUpAt ? new Date(t.nextFollowUpAt).toLocaleDateString() : '—'}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {OUTCOMES.map((o) => (
                        <Button key={o} size="sm" variant="outline" onClick={() => recordOutcome(t.id, o)}>
                          {o.replace(/_/g, ' ')}
                        </Button>
                      ))}
                    </div>
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
