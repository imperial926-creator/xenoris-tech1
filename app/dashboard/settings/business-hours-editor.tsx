'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
] as const;

type DayHours = { open: string; close: string; closed: boolean };
type OpeningHours = Partial<Record<(typeof DAYS)[number]['key'], DayHours>>;

const DEFAULT_DAY: DayHours = { open: '09:00', close: '21:00', closed: false };

export function BusinessHoursEditor({
  branchId,
  initialHours,
}: {
  branchId: string;
  initialHours: OpeningHours | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState<OpeningHours>(() => {
    const base: OpeningHours = {};
    for (const d of DAYS) base[d.key] = initialHours?.[d.key] ?? { ...DEFAULT_DAY };
    return base;
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function updateDay(key: (typeof DAYS)[number]['key'], patch: Partial<DayHours>) {
    setHours((h) => ({ ...h, [key]: { ...(h[key] as DayHours), ...patch } }));
  }

  async function save() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/branches/${branchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openingHours: hours }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not save business hours.');
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Edit hours
      </Button>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-md border p-3">
      {DAYS.map((d) => {
        const day = hours[d.key] as DayHours;
        return (
          <div key={d.key} className="flex items-center gap-3 text-sm">
            <span className="w-10 font-medium">{d.label}</span>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={!day.closed}
                onChange={(e) => updateDay(d.key, { closed: !e.target.checked })}
              />
              Open
            </label>
            {!day.closed && (
              <>
                <Input
                  type="time"
                  className="h-8 w-28"
                  value={day.open}
                  onChange={(e) => updateDay(d.key, { open: e.target.value })}
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="time"
                  className="h-8 w-28"
                  value={day.close}
                  onChange={(e) => updateDay(d.key, { close: e.target.value })}
                />
              </>
            )}
          </div>
        );
      })}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2 pt-2">
        <Button size="sm" onClick={save} disabled={loading}>
          {loading ? 'Saving…' : 'Save hours'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
