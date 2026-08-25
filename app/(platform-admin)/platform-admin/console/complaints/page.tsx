'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Complaint {
  id: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  createdAt: string;
  organization: { id: string; name: string };
  assignedToAdmin: { id: string; firstName: string; lastName: string } | null;
}

interface Analytics {
  total: number;
  resolved: number;
  escalated: number;
  resolutionRate: number;
  averageResolutionHours: number;
}

const STATUS_OPTIONS = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED'];

// Master spec's Customer Support / Complaints module.
export default function ComplaintsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  const load = useCallback(() => {
    fetch('/api/platform-admin/complaints')
      .then((r) => r.json())
      .then((d) => setComplaints(d.complaints));
    fetch('/api/platform-admin/complaints/analytics?preset=last_30_days')
      .then((r) => r.json())
      .then((d) => setAnalytics(d.analytics));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = async (complaintId: string, status: string) => {
    await fetch(`/api/platform-admin/complaints/${complaintId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Complaints</h1>

      {analytics && (
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-5">
            <div>
              <p className="text-xs text-muted-foreground">Total (30d)</p>
              <p className="text-lg font-semibold">{analytics.total}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Resolved</p>
              <p className="text-lg font-semibold">{analytics.resolved}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Escalated</p>
              <p className="text-lg font-semibold">{analytics.escalated}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Resolution Rate</p>
              <p className="text-lg font-semibold">{analytics.resolutionRate}%</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg Resolution</p>
              <p className="text-lg font-semibold">{analytics.averageResolutionHours}h</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Complaints</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2">Restaurant</th>
                <th className="py-2">Subject</th>
                <th className="py-2">Category</th>
                <th className="py-2">Priority</th>
                <th className="py-2">Status</th>
                <th className="py-2">Assigned</th>
              </tr>
            </thead>
            <tbody>
              {complaints.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-muted-foreground">
                    No complaints logged.
                  </td>
                </tr>
              )}
              {complaints.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-2">{c.organization.name}</td>
                  <td className="py-2">{c.subject}</td>
                  <td className="py-2 text-xs">{c.category}</td>
                  <td className="py-2">{c.priority}</td>
                  <td className="py-2">
                    <select
                      className="rounded border px-2 py-1 text-xs"
                      value={c.status}
                      onChange={(e) => updateStatus(c.id, e.target.value)}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">{c.assignedToAdmin ? `${c.assignedToAdmin.firstName} ${c.assignedToAdmin.lastName}` : 'Unassigned'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Complaints are logged by restaurant owners from their own dashboard, or by support staff on a restaurant&apos;s
        behalf (phone/email intake) — there is no separate creation form here yet; see docs/architecture.md §26.
      </p>
    </div>
  );
}
