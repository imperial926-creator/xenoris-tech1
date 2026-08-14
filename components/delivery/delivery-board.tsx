'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';

interface Branch {
  id: string;
  name: string;
}
interface Zone {
  id: string;
  name: string;
  description: string | null;
  deliveryFee: string;
  active: boolean;
}
interface DriverUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}
interface Driver {
  id: string;
  vehicleType: string | null;
  vehiclePlate: string | null;
  phone: string | null;
  active: boolean;
  user: { firstName: string; lastName: string; email: string };
}
interface DeliveryOrderRow {
  id: string;
  status: string;
  deliveryFee: string;
  estimatedDeliveryAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  order: {
    id: string;
    guestName: string | null;
    guestPhone: string | null;
    deliveryAddress: string | null;
    total: string;
  };
  deliveryZone: { name: string } | null;
  driver: { id: string; user: { firstName: string; lastName: string } } | null;
}

const DELIVERY_STATUSES = ['UNASSIGNED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'FAILED', 'CANCELLED'];

const NEXT_STATUS_ACTIONS: Record<string, { status: string; label: string; variant?: 'default' | 'outline' }[]> = {
  ASSIGNED: [
    { status: 'PICKED_UP', label: 'Mark picked up' },
    { status: 'CANCELLED', label: 'Cancel', variant: 'outline' },
  ],
  PICKED_UP: [
    { status: 'DELIVERED', label: 'Mark delivered' },
    { status: 'FAILED', label: 'Mark failed', variant: 'outline' },
    { status: 'CANCELLED', label: 'Cancel', variant: 'outline' },
  ],
  UNASSIGNED: [{ status: 'CANCELLED', label: 'Cancel', variant: 'outline' }],
  FAILED: [{ status: 'CANCELLED', label: 'Cancel', variant: 'outline' }],
  DELIVERED: [],
  CANCELLED: [],
};

export function DeliveryBoard({ branches }: { branches: Branch[] }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [zones, setZones] = useState<Zone[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [eligibleUsers, setEligibleUsers] = useState<DriverUser[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryOrderRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [zoneForm, setZoneForm] = useState({ name: '', deliveryFee: '0.00' });
  const [driverUserId, setDriverUserId] = useState('');
  const [assignDriverByDelivery, setAssignDriverByDelivery] = useState<Record<string, string>>({});
  const [reasonByDelivery, setReasonByDelivery] = useState<Record<string, string>>({});

  const load = useCallback(async (id: string, status: string) => {
    if (!id) return;
    setError(null);
    try {
      const qs = status ? `?status=${status}` : '';
      const [zonesRes, driversRes, usersRes, deliveriesRes] = await Promise.all([
        fetch(`/api/branches/${id}/delivery-zones`),
        fetch(`/api/branches/${id}/drivers`),
        fetch(`/api/branches/${id}/drivers/eligible-users`),
        fetch(`/api/branches/${id}/deliveries${qs}`),
      ]);
      const zonesData = await zonesRes.json();
      const driversData = await driversRes.json();
      const usersData = await usersRes.json();
      const deliveriesData = await deliveriesRes.json();
      if (!zonesRes.ok) throw new Error(zonesData.error ?? 'Failed to load delivery zones.');
      if (!driversRes.ok) throw new Error(driversData.error ?? 'Failed to load drivers.');
      if (!usersRes.ok) throw new Error(usersData.error ?? 'Failed to load eligible users.');
      if (!deliveriesRes.ok) throw new Error(deliveriesData.error ?? 'Failed to load deliveries.');
      setZones(zonesData.zones);
      setDrivers(driversData.drivers);
      setEligibleUsers(usersData.users);
      setDeliveries(deliveriesData.deliveries);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }, []);

  useEffect(() => {
    load(branchId, statusFilter);
  }, [branchId, statusFilter, load]);

  async function createZone() {
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/delivery-zones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(zoneForm),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not create zone.');
      return;
    }
    setZoneForm({ name: '', deliveryFee: '0.00' });
    load(branchId, statusFilter);
  }

  async function createDriver() {
    if (!driverUserId) return;
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: driverUserId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not create driver profile.');
      return;
    }
    setDriverUserId('');
    load(branchId, statusFilter);
  }

  async function assignDriver(deliveryId: string) {
    const driverId = assignDriverByDelivery[deliveryId];
    if (!driverId) return;
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/deliveries/${deliveryId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not assign driver.');
      return;
    }
    load(branchId, statusFilter);
  }

  async function changeStatus(deliveryId: string, status: string) {
    setError(null);
    const note = reasonByDelivery[deliveryId];
    if ((status === 'CANCELLED' || status === 'FAILED') && !note) {
      setError(`A note is required to mark a delivery ${status}.`);
      return;
    }
    const res = await fetch(`/api/branches/${branchId}/deliveries/${deliveryId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, note }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not update delivery status.');
      return;
    }
    setReasonByDelivery((r) => {
      const next = { ...r };
      delete next[deliveryId];
      return next;
    });
    load(branchId, statusFilter);
  }

  if (branches.length === 0) {
    return <p className="text-sm text-muted-foreground">No branches yet — add one under Settings first.</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="deliveryBranchSelect" className="text-sm">
          Branch
        </Label>
        <select
          id="deliveryBranchSelect"
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery zones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="zoneName" className="text-xs">
                Name
              </Label>
              <Input
                id="zoneName"
                className="w-48"
                value={zoneForm.name}
                onChange={(e) => setZoneForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="zoneFee" className="text-xs">
                Delivery fee
              </Label>
              <Input
                id="zoneFee"
                className="w-28"
                value={zoneForm.deliveryFee}
                onChange={(e) => setZoneForm((f) => ({ ...f, deliveryFee: e.target.value }))}
              />
            </div>
            <Button size="sm" onClick={createZone} disabled={!zoneForm.name}>
              Add zone
            </Button>
          </div>
          <ul className="space-y-1 text-sm">
            {zones.length === 0 && <li className="text-muted-foreground">No delivery zones yet.</li>}
            {zones.map((z) => (
              <li key={z.id} className="flex items-center justify-between">
                <span>
                  {z.name} — ₱{z.deliveryFee} {!z.active && <span className="text-muted-foreground">(inactive)</span>}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Drivers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="driverUser" className="text-xs">
                User (must have the DRIVER role)
              </Label>
              <select
                id="driverUser"
                className="h-9 w-64 rounded-md border border-input bg-background px-2 text-sm"
                value={driverUserId}
                onChange={(e) => setDriverUserId(e.target.value)}
              >
                <option value="">Select a user…</option>
                {eligibleUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName} ({u.email})
                  </option>
                ))}
              </select>
            </div>
            <Button size="sm" onClick={createDriver} disabled={!driverUserId}>
              Add driver
            </Button>
          </div>
          {eligibleUsers.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No eligible users — grant the DRIVER role to a staff account first (Settings → Roles).
            </p>
          )}
          <ul className="space-y-1 text-sm">
            {drivers.length === 0 && <li className="text-muted-foreground">No drivers yet.</li>}
            {drivers.map((d) => (
              <li key={d.id}>
                {d.user.firstName} {d.user.lastName} {d.vehicleType && `— ${d.vehicleType}`}{' '}
                {!d.active && <span className="text-muted-foreground">(inactive)</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">Deliveries</h2>
          <Label htmlFor="deliveryStatusFilter" className="text-sm">
            Status
          </Label>
          <select
            id="deliveryStatusFilter"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All</option>
            {DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          {deliveries.length === 0 && <p className="text-sm text-muted-foreground">No deliveries.</p>}
          {deliveries.map((d) => {
            const actions = NEXT_STATUS_ACTIONS[d.status] ?? [];
            const activeDrivers = drivers.filter((driver) => driver.active);
            return (
              <Card key={d.id} className={cn(d.status === 'FAILED' && 'border-destructive')}>
                <CardContent className="space-y-2 pt-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">Order #{d.order.id.slice(-6).toUpperCase()}</span>
                    <span className="text-xs text-muted-foreground">{d.status.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="text-muted-foreground">
                    {d.order.guestName ?? 'Guest'} {d.order.guestPhone && `· ${d.order.guestPhone}`}
                  </p>
                  <p className="text-muted-foreground">{d.order.deliveryAddress}</p>
                  <p>
                    Zone: {d.deliveryZone?.name ?? '—'} · Fee: ₱{d.deliveryFee} · Order total: ₱{d.order.total}
                  </p>
                  <p>Driver: {d.driver ? `${d.driver.user.firstName} ${d.driver.user.lastName}` : 'Unassigned'}</p>

                  {(d.status === 'UNASSIGNED' || d.status === 'ASSIGNED' || d.status === 'FAILED') && (
                    <div className="flex items-center gap-2">
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        value={assignDriverByDelivery[d.id] ?? ''}
                        onChange={(e) => setAssignDriverByDelivery((m) => ({ ...m, [d.id]: e.target.value }))}
                      >
                        <option value="">Assign driver…</option>
                        {activeDrivers.map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.user.firstName} {driver.user.lastName}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="outline" onClick={() => assignDriver(d.id)}>
                        Assign
                      </Button>
                    </div>
                  )}

                  {(d.status === 'PICKED_UP' || actions.some((a) => a.status === 'CANCELLED' || a.status === 'FAILED')) && (
                    <Input
                      placeholder="Note (required for cancel/fail)"
                      className="h-8 text-xs"
                      value={reasonByDelivery[d.id] ?? ''}
                      onChange={(e) => setReasonByDelivery((r) => ({ ...r, [d.id]: e.target.value }))}
                    />
                  )}

                  <div className="flex flex-wrap gap-2">
                    {actions.map((action) => (
                      <Button
                        key={action.status}
                        size="sm"
                        variant={action.variant ?? 'default'}
                        onClick={() => changeStatus(d.id, action.status)}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
