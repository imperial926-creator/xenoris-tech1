'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

interface Task {
  id: string;
  type: string;
  status: string;
  priority: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  createdAt: string;
  revenueImpact: string | null;
  organization: { id: string; name: string } | null;
  assignedAdmin: { id: string; firstName: string; lastName: string } | null;
}

interface DashboardCounts {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  dueToday: number;
  overdue: number;
  unassigned: number;
  inProgress: number;
  completedToday: number;
  escalated: number;
}

const STATUS_OPTIONS = ['OPEN', 'NEW', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'FOLLOW_UP_REQUIRED', 'ESCALATED', 'RESOLVED', 'CLOSED', 'DISMISSED', 'CANCELLED'];

// Master spec's unified Action Center — "the administrator should be able
// to open the application each morning and immediately understand what
// needs attention" (spec's own framing). This is the richer Phase 18 view;
// the simpler Phase 17 billing-only view still exists at
// /platform-admin/billing/action-center for billing-scoped triage.
export default function ActionCenterConsolePage() {
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(() => {
    fetch('/api/platform-admin/action-center/dashboard')
      .then((r) => r.json())
      .then((d) => setCounts(d.counts));
    const params = new URLSearchParams();
    if (priorityFilter) params.set('priority', priorityFilter);
    if (statusFilter) params.set('status', statusFilter);
    fetch(`/api/platform-admin/action-center?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks));
  }, [priorityFilter, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = async (taskId: string, status: string) => {
    await fetch(`/api/platform-admin/action-center/${taskId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const escalate = async (taskId: string) => {
    await fetch(`/api/platform-admin/action-center/${taskId}/escalate`, { method: 'POST' });
    load();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Action Center</h1>

      {counts && (
        <Card>
          <CardContent className="grid grid-cols-3 gap-4 pt-6 sm:grid-cols-6">
            {Object.entries(counts).map(([key, value]) => (
              <div key={key}>
                <p className="text-xs text-muted-foreground">{key.replace(/([A-Z])/g, ' $1')}</p>
                <p className="text-lg font-semibold">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-4">
        <Select
          label="Priority"
          hideLabel
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          wrapperClassName="w-48"
        >
          <option value="">All priorities</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </Select>
        <Select
          label="Status"
          hideLabel
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          wrapperClassName="w-48"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2">Priority</th>
                <th className="py-2">Title</th>
                <th className="py-2">Restaurant</th>
                <th className="py-2">Status</th>
                <th className="py-2">Assigned</th>
                <th className="py-2">Due</th>
                <th className="py-2">Revenue Impact</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-muted-foreground">
                    No tasks match this filter.
                  </td>
                </tr>
              )}
              {tasks.map((t) => (
                <tr key={t.id} className="border-b last:border-0 align-top">
                  <td className="py-2 font-medium">{t.priority}</td>
                  <td className="py-2">
                    <p className="font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">{t.type}</p>
                  </td>
                  <td className="py-2">{t.organization?.name ?? '—'}</td>
                  <td className="py-2">
                    <select
                      className="rounded border px-2 py-1 text-xs"
                      value={t.status}
                      onChange={(e) => updateStatus(t.id, e.target.value)}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    {t.assignedAdmin ? `${t.assignedAdmin.firstName} ${t.assignedAdmin.lastName}` : 'Unassigned'}
                  </td>
                  <td className="py-2">{t.dueAt ? new Date(t.dueAt).toLocaleDateString() : '—'}</td>
                  <td className="py-2">{t.revenueImpact ? `₱${t.revenueImpact}` : '—'}</td>
                  <td className="py-2">
                    <Button size="sm" variant="outline" onClick={() => escalate(t.id)}>
                      Escalate
                    </Button>
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
