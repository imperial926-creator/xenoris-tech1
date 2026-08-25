'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Task {
  id: string;
  type: string;
  status: 'OPEN' | 'RESOLVED';
  title: string;
  description: string | null;
  organization: { id: string; name: string } | null;
  createdAt: string;
}

// Master spec §45. First implementation of Action Center anywhere in this
// codebase — see ActionCenterService's header for why.
export default function PlatformAdminActionCenterPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<'OPEN' | 'RESOLVED'>('OPEN');

  function load() {
    fetch(`/api/platform-admin/action-center?status=${filter}`)
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks ?? []));
  }

  useEffect(load, [filter]);

  async function resolve(taskId: string) {
    await fetch(`/api/platform-admin/action-center/${taskId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Action Center</h1>
          <p className="text-sm text-muted-foreground">Billing events needing SaaS Owner follow-up.</p>
        </div>
        <div className="flex gap-2">
          <Button variant={filter === 'OPEN' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('OPEN')}>
            Open
          </Button>
          <Button variant={filter === 'RESOLVED' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('RESOLVED')}>
            Resolved
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{filter === 'OPEN' ? 'Open tasks' : 'Resolved tasks'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tasks.length === 0 && <p className="text-sm text-muted-foreground">Nothing here.</p>}
          {tasks.map((t) => (
            <div key={t.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{t.title}</p>
                  {t.description && <p className="whitespace-pre-line text-muted-foreground">{t.description}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.type} {t.organization ? `· ${t.organization.name}` : ''} ·{' '}
                    {new Date(t.createdAt).toLocaleString()}
                  </p>
                </div>
                {t.status === 'OPEN' && (
                  <Button variant="outline" size="sm" onClick={() => resolve(t.id)}>
                    Resolve
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
