'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReservationStatusBadge } from './reservation-status-badge';

interface Branch {
  id: string;
  name: string;
}
interface Section {
  id: string;
  name: string;
}
interface AvailableTable {
  id: string;
  tableNumber: string;
  capacity: number;
  section: Section | null;
}
interface ReservationTableRow {
  id: string;
  table: { id: string; tableNumber: string };
}
interface Reservation {
  id: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  startAt: string;
  endAt: string;
  guestCount: number;
  status: string;
  specialRequests: string | null;
  occasion: string | null;
  depositRequired: boolean;
  depositAmount: string | null;
  depositStatus: string;
  depositNote: string | null;
  cancellationReason: string | null;
  tables: ReservationTableRow[];
}

const NEXT_STATUS_ACTIONS: Record<string, { status: string; label: string; variant?: 'default' | 'outline' }[]> = {
  PENDING: [
    { status: 'CONFIRMED', label: 'Confirm' },
    { status: 'CANCELLED', label: 'Cancel', variant: 'outline' },
  ],
  CONFIRMED: [
    { status: 'SEATED', label: 'Seat' },
    { status: 'NO_SHOW', label: 'No-show', variant: 'outline' },
    { status: 'CANCELLED', label: 'Cancel', variant: 'outline' },
  ],
  SEATED: [
    { status: 'COMPLETED', label: 'Complete' },
    { status: 'CANCELLED', label: 'Cancel', variant: 'outline' },
  ],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function ReservationBoard({ branches }: { branches: Branch[] }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Record<string, string>>({});
  const [depositEditing, setDepositEditing] = useState<string | null>(null);

  const loadReservations = useCallback(async (id: string, status: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const qs = status ? `?status=${status}` : '';
      const res = await fetch(`/api/branches/${id}/reservations${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load reservations.');
      setReservations(data.reservations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReservations(branchId, statusFilter);
  }, [branchId, statusFilter, loadReservations]);

  async function changeStatus(reservationId: string, status: string, cancellationReason?: string) {
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/reservations/${reservationId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, cancellationReason }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not update reservation status.');
      return;
    }
    setCancelling((c) => {
      const next = { ...c };
      delete next[reservationId];
      return next;
    });
    loadReservations(branchId, statusFilter);
  }

  async function recordDeposit(reservationId: string, depositStatus: string, depositAmount: string, depositNote: string) {
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/reservations/${reservationId}/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        depositStatus,
        depositAmount: depositAmount || undefined,
        depositNote: depositNote || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not record deposit.');
      return;
    }
    setDepositEditing(null);
    loadReservations(branchId, statusFilter);
  }

  if (branches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No branches yet — add one under Settings first.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="resBranchSelect" className="text-sm">
          Branch
        </Label>
        <select
          id="resBranchSelect"
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

        <Label htmlFor="statusFilter" className="text-sm">
          Status
        </Label>
        <select
          id="statusFilter"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All</option>
          {['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <NewReservationForm branchId={branchId} onCreated={() => loadReservations(branchId, statusFilter)} />

      <div className="space-y-3">
        {reservations.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">No reservations match this filter.</p>
        )}
        {reservations.map((r) => (
          <Card key={r.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span>
                  {r.guestName} · party of {r.guestCount}
                </span>
                <ReservationStatusBadge status={r.status} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {formatDateTime(r.startAt)} – {formatDateTime(r.endAt)}
              </p>
              <p className="text-xs text-muted-foreground">
                Table(s): {r.tables.map((t) => t.table.tableNumber).join(', ') || '—'}
                {r.guestEmail && <> · {r.guestEmail}</>}
                {r.guestPhone && <> · {r.guestPhone}</>}
              </p>
              {r.occasion && <p className="text-xs text-muted-foreground">Occasion: {r.occasion}</p>}
              {r.specialRequests && (
                <p className="text-xs text-muted-foreground">Notes: {r.specialRequests}</p>
              )}
              {r.cancellationReason && (
                <p className="text-xs text-destructive">Cancelled: {r.cancellationReason}</p>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <span className="text-xs text-muted-foreground">
                  Deposit: {r.depositRequired ? `₱${r.depositAmount ?? '0.00'} (${r.depositStatus})` : 'Not required'}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDepositEditing(depositEditing === r.id ? null : r.id)}
                >
                  {depositEditing === r.id ? 'Close' : 'Record deposit'}
                </Button>
              </div>

              {depositEditing === r.id && (
                <DepositForm
                  reservationId={r.id}
                  initialAmount={r.depositAmount ?? ''}
                  onSubmit={recordDeposit}
                />
              )}

              {cancelling[r.id] !== undefined ? (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <Input
                    placeholder="Reason for cancellation"
                    className="max-w-xs"
                    value={cancelling[r.id]}
                    onChange={(e) => setCancelling((c) => ({ ...c, [r.id]: e.target.value }))}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!cancelling[r.id]?.trim()}
                    onClick={() => changeStatus(r.id, 'CANCELLED', cancelling[r.id])}
                  >
                    Confirm cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setCancelling((c) => {
                        const next = { ...c };
                        delete next[r.id];
                        return next;
                      })
                    }
                  >
                    Back
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  {(NEXT_STATUS_ACTIONS[r.status] ?? []).map((action) =>
                    action.status === 'CANCELLED' ? (
                      <Button
                        key={action.status}
                        type="button"
                        size="sm"
                        variant={action.variant ?? 'default'}
                        onClick={() => setCancelling((c) => ({ ...c, [r.id]: '' }))}
                      >
                        {action.label}
                      </Button>
                    ) : (
                      <Button
                        key={action.status}
                        type="button"
                        size="sm"
                        variant={action.variant ?? 'default'}
                        onClick={() => changeStatus(r.id, action.status)}
                      >
                        {action.label}
                      </Button>
                    ),
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DepositForm({
  reservationId,
  initialAmount,
  onSubmit,
}: {
  reservationId: string;
  initialAmount: string;
  onSubmit: (reservationId: string, depositStatus: string, depositAmount: string, depositNote: string) => void;
}) {
  const [depositStatus, setDepositStatus] = useState('PAID');
  const [depositAmount, setDepositAmount] = useState(initialAmount);
  const [depositNote, setDepositNote] = useState('');
  // Phase 15 hardening: this Label was only visually adjacent to the
  // select, not programmatically associated with it — a screen reader
  // announced it as an unlabeled combobox. htmlFor/id wires them together.
  const statusId = useId();

  return (
    <div className="flex flex-wrap items-end gap-2 border-t pt-3">
      <div className="space-y-1">
        <Label htmlFor={statusId} className="text-xs">Status</Label>
        <select
          id={statusId}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={depositStatus}
          onChange={(e) => setDepositStatus(e.target.value)}
        >
          {['NONE', 'PENDING', 'PAID', 'REFUNDED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Amount (₱)</Label>
        <Input
          className="w-24"
          placeholder="0.00"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
        />
      </div>
      <div className="flex-1 space-y-1">
        <Label className="text-xs">Note</Label>
        <Input
          placeholder="e.g. Cash received via GCash, confirmed by phone"
          value={depositNote}
          onChange={(e) => setDepositNote(e.target.value)}
        />
      </div>
      <Button
        type="button"
        size="sm"
        onClick={() => onSubmit(reservationId, depositStatus, depositAmount, depositNote)}
      >
        Save
      </Button>
    </div>
  );
}

function NewReservationForm({ branchId, onCreated }: { branchId: string; onCreated: () => void }) {
  const today = new Date();
  const defaultDate = today.toISOString().slice(0, 10);

  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('18:00');
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [guestCount, setGuestCount] = useState(2);
  const [availableTables, setAvailableTables] = useState<AvailableTable[]>([]);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);

  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [occasion, setOccasion] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [depositRequired, setDepositRequired] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNote, setDepositNote] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function startAtIso() {
    // Interpreted in the browser's local timezone. This is a staff-facing
    // dashboard used from the branch itself in normal operation; a
    // timezone-aware picker (using Branch.timezone explicitly) is a
    // reasonable future improvement, not built here to avoid pulling in a
    // date library this sandbox can't npm-install to verify (see
    // ReservationService.assertWithinBusinessHours for the same reasoning).
    return new Date(`${date}T${time}`).toISOString();
  }

  async function searchAvailability() {
    if (!branchId) return;
    setSearching(true);
    setError(null);
    setSearched(true);
    setSelectedTableIds([]);
    try {
      const qs = new URLSearchParams({
        startAt: startAtIso(),
        durationMinutes: String(durationMinutes),
        guestCount: String(guestCount),
      });
      const res = await fetch(`/api/branches/${branchId}/reservations/availability?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not search availability.');
      setAvailableTables(data.tables);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSearching(false);
    }
  }

  function toggleTable(tableId: string) {
    setSelectedTableIds((ids) =>
      ids.includes(tableId) ? ids.filter((id) => id !== tableId) : [...ids, tableId],
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!branchId || selectedTableIds.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/branches/${branchId}/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableIds: selectedTableIds,
          startAt: startAtIso(),
          durationMinutes,
          guestCount,
          guestName,
          guestEmail: guestEmail || undefined,
          guestPhone: guestPhone || undefined,
          occasion: occasion || undefined,
          specialRequests: specialRequests || undefined,
          depositRequired,
          depositAmount: depositRequired ? depositAmount || '0.00' : undefined,
          depositNote: depositNote || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not create reservation.');
        return;
      }
      setGuestName('');
      setGuestEmail('');
      setGuestPhone('');
      setOccasion('');
      setSpecialRequests('');
      setDepositRequired(false);
      setDepositAmount('');
      setDepositNote('');
      setSelectedTableIds([]);
      setAvailableTables([]);
      setSearched(false);
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New reservation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Time</Label>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Duration (min)</Label>
            <Input
              type="number"
              className="w-24"
              min={30}
              max={480}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Party size</Label>
            <Input
              type="number"
              className="w-20"
              min={1}
              max={500}
              value={guestCount}
              onChange={(e) => setGuestCount(Number(e.target.value))}
            />
          </div>
          <Button type="button" variant="outline" onClick={searchAvailability} disabled={searching || !branchId}>
            {searching ? 'Searching…' : 'Search availability'}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {searched && (
          <div className="space-y-2">
            {availableTables.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tables available for this window.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Select one or more tables (combine tables for large parties):
                </p>
                <div className="flex flex-wrap gap-2">
                  {availableTables.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => toggleTable(t.id)}
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        selectedTableIds.includes(t.id)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-background'
                      }`}
                    >
                      Table {t.tableNumber} · seats {t.capacity}
                      {t.section && ` · ${t.section.name}`}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {selectedTableIds.length > 0 && (
          <form onSubmit={onSubmit} className="space-y-3 border-t pt-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Guest name</Label>
                <Input required value={guestName} onChange={(e) => setGuestName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email (optional)</Label>
                <Input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone (optional)</Label>
                <Input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Occasion (optional)</Label>
                <Input value={occasion} onChange={(e) => setOccasion(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Special requests (optional)</Label>
                <Input value={specialRequests} onChange={(e) => setSpecialRequests(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={depositRequired}
                  onChange={(e) => setDepositRequired(e.target.checked)}
                />
                Deposit required
              </label>
              {depositRequired && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Amount (₱)</Label>
                    <Input
                      className="w-24"
                      placeholder="0.00"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Note</Label>
                    <Input value={depositNote} onChange={(e) => setDepositNote(e.target.value)} />
                  </div>
                </>
              )}
            </div>

            <Button type="submit" disabled={submitting}>
              {submitting ? 'Booking…' : `Book ${selectedTableIds.length} table(s)`}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
