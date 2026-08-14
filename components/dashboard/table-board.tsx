'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TableStatusBadge } from './table-status-badge';

const STATUSES = ['AVAILABLE', 'RESERVED', 'OCCUPIED', 'WAITING', 'CLEANING', 'OUT_OF_SERVICE'];

interface Branch {
  id: string;
  name: string;
}
interface Section {
  id: string;
  name: string;
}
interface TableRow {
  id: string;
  tableNumber: string;
  capacity: number;
  status: string;
  sectionId: string | null;
  section: Section | null;
}

export function TableBoard({ branches }: { branches: Branch[] }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [sections, setSections] = useState<Section[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [sectionsRes, tablesRes] = await Promise.all([
        fetch(`/api/branches/${id}/sections`),
        fetch(`/api/branches/${id}/tables`),
      ]);
      const sectionsData = await sectionsRes.json();
      const tablesData = await tablesRes.json();
      if (!sectionsRes.ok) throw new Error(sectionsData.error ?? 'Failed to load sections.');
      if (!tablesRes.ok) throw new Error(tablesData.error ?? 'Failed to load tables.');
      setSections(sectionsData.sections);
      setTables(tablesData.tables);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(branchId);
  }, [branchId, load]);

  async function changeStatus(tableId: string, status: string) {
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/tables/${tableId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not change status.');
      return;
    }
    load(branchId);
  }

  if (branches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No branches yet — add one under Settings first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label htmlFor="branchSelect" className="text-sm">
          Branch
        </Label>
        <select
          id="branchSelect"
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
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tables.length === 0 && !loading && (
          <p className="col-span-full text-sm text-muted-foreground">
            No tables at this branch yet — add one below.
          </p>
        )}
        {tables.map((t) => (
          <Card key={t.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>Table {t.tableNumber}</span>
                <TableStatusBadge status={t.status} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Seats {t.capacity} · {t.section?.name ?? 'No section'}
              </p>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={t.status}
                onChange={(e) => changeStatus(t.id, e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AddSectionForm branchId={branchId} onCreated={() => load(branchId)} />
        <AddTableForm branchId={branchId} sections={sections} onCreated={() => load(branchId)} />
      </div>
    </div>
  );
}

function AddSectionForm({ branchId, onCreated }: { branchId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/branches/${branchId}/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not create section.');
        return;
      }
      setName('');
      onCreated();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Add section</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="sectionName" className="text-xs">
              Name
            </Label>
            <Input
              id="sectionName"
              required
              placeholder="Patio, Main Dining, ..."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={loading || !branchId}>
            Add
          </Button>
        </form>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function AddTableForm({
  branchId,
  sections,
  onCreated,
}: {
  branchId: string;
  sections: Section[];
  onCreated: () => void;
}) {
  const [tableNumber, setTableNumber] = useState('');
  const [capacity, setCapacity] = useState(4);
  const [sectionId, setSectionId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/branches/${branchId}/tables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableNumber, capacity, sectionId: sectionId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not create table.');
        return;
      }
      setTableNumber('');
      onCreated();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Add table</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="tableNumber" className="text-xs">
              Number
            </Label>
            <Input
              id="tableNumber"
              required
              className="w-20"
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="capacity" className="text-xs">
              Seats
            </Label>
            <Input
              id="capacity"
              type="number"
              min={1}
              max={50}
              className="w-20"
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="section" className="text-xs">
              Section
            </Label>
            <select
              id="section"
              className="h-10 rounded-md border border-input bg-background px-2 text-sm"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
            >
              <option value="">None</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" size="sm" disabled={loading || !branchId}>
            Add
          </Button>
        </form>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
