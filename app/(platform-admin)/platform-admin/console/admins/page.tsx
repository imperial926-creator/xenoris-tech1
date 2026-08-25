'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface Admin {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
}

const ROLES = ['SUPER_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'SALES_ADMIN', 'ANALYTICS_ADMIN', 'DEVELOPER', 'AUDITOR'];

// Master spec's admin RBAC matrix. SUPER_ADMIN-only — non-SUPER_ADMIN
// callers get a 403 from every mutation here (enforced server-side in
// lib/platform-admin/rbac.ts, not just hidden client-side).
export default function AdminsPage() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('SUPPORT_ADMIN');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/platform-admin/admins')
      .then((r) => r.json())
      .then((d) => setAdmins(d.admins ?? []));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createAdmin = async () => {
    setError(null);
    const res = await fetch('/api/platform-admin/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, firstName, lastName, role }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Failed to create admin.');
      return;
    }
    setEmail('');
    setPassword('');
    setFirstName('');
    setLastName('');
    load();
  };

  const changeRole = async (adminId: string, newRole: string) => {
    await fetch(`/api/platform-admin/admins/${adminId}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    load();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Admins & Roles</h1>

      <Card>
        <CardHeader>
          <CardTitle>Provision New Admin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input placeholder="Temporary password (min 12 chars)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Input placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <Input placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={createAdmin}>Create Admin</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing Admins</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2">Name</th>
                <th className="py-2">Email</th>
                <th className="py-2">Role</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="py-2">
                    {a.firstName} {a.lastName}
                  </td>
                  <td className="py-2">{a.email}</td>
                  <td className="py-2">
                    <select className="rounded border px-2 py-1 text-xs" value={a.role} onChange={(e) => changeRole(a.id, e.target.value)}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
