'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface Complaint {
  id: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  description: string;
  createdAt: string;
  resolutionNotes: string | null;
}

// Restaurant-owner-facing complaint intake — "tell the SaaS platform about
// a problem" (billing, technical, service quality, etc.). Surfaces into
// the platform admin's Action Center/Complaints module — see
// docs/architecture.md §26.
export default function SupportPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [category, setCategory] = useState('TECHNICAL');
  const [priority, setPriority] = useState('MEDIUM');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    fetch('/api/support/complaints')
      .then((r) => r.json())
      .then((d) => setComplaints(d.complaints ?? []));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!subject.trim() || !description.trim()) return;
    setSubmitting(true);
    await fetch('/api/support/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, priority, subject, description }),
    });
    setSubject('');
    setDescription('');
    setSubmitting(false);
    load();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Support</h1>

      <Card>
        <CardHeader>
          <CardTitle>Raise a Complaint</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="BILLING">Billing</option>
              <option value="TECHNICAL">Technical</option>
              <option value="SERVICE_QUALITY">Service Quality</option>
              <option value="FEATURE_REQUEST">Feature Request</option>
              <option value="ACCOUNT">Account</option>
              <option value="OTHER">Other</option>
            </Select>
            <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Subject</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Description</label>
            <textarea
              className="w-full rounded-md border px-3 py-2 text-sm"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened?"
            />
          </div>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your Complaints</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2">Subject</th>
                <th className="py-2">Category</th>
                <th className="py-2">Status</th>
                <th className="py-2">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {complaints.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-muted-foreground">
                    No complaints submitted yet.
                  </td>
                </tr>
              )}
              {complaints.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-2">{c.subject}</td>
                  <td className="py-2 text-xs">{c.category}</td>
                  <td className="py-2">{c.status.replace(/_/g, ' ')}</td>
                  <td className="py-2">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
