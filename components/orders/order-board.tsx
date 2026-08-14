'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OrderStatusBadge } from './order-status-badge';

interface Branch {
  id: string;
  name: string;
}
interface TableRow {
  id: string;
  tableNumber: string;
  status: string;
}
interface Modifier {
  id: string;
  name: string;
  priceDelta: string;
  active: boolean;
}
interface ModifierGroup {
  id: string;
  name: string;
  selectionType: 'SINGLE' | 'MULTIPLE';
  required: boolean;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}
interface Variant {
  id: string;
  name: string;
  price: string;
  active: boolean;
}
interface MenuItemRow {
  id: string;
  name: string;
  price: string;
  active: boolean;
  available: boolean;
  category: { name: string } | null;
  variants: Variant[];
  modifierGroups: { modifierGroup: ModifierGroup }[];
}
interface CartLine {
  key: string;
  menuItemId: string;
  label: string;
  unitPrice: number;
  quantity: number;
  modifierIds: string[];
  modifiersLabel: string;
  modifiersUnitTotal: number;
  menuItemVariantId?: string;
  notes?: string;
}
interface OrderItemRow {
  id: string;
  nameSnapshot: string;
  unitPriceSnapshot: string;
  quantity: number;
  lineTotal: string;
  modifiers: { nameSnapshot: string }[];
}
interface OrderPaymentRow {
  id: string;
  method: string;
  amount: string;
  status: string;
}
interface Order {
  id: string;
  type: string;
  status: string;
  guestName: string | null;
  tableId: string | null;
  table: { tableNumber: string } | null;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  total: string;
  createdAt: string;
  items: OrderItemRow[];
  payments: OrderPaymentRow[];
}

const NEXT_STATUS_ACTIONS: Record<string, { status: string; label: string; variant?: 'default' | 'outline' }[]> = {
  PENDING: [
    { status: 'CONFIRMED', label: 'Confirm' },
    { status: 'CANCELLED', label: 'Cancel', variant: 'outline' },
  ],
  CONFIRMED: [
    { status: 'PREPARING', label: 'Start preparing' },
    { status: 'CANCELLED', label: 'Cancel', variant: 'outline' },
  ],
  PREPARING: [
    { status: 'READY', label: 'Mark ready' },
    { status: 'CANCELLED', label: 'Cancel', variant: 'outline' },
  ],
  READY: [
    { status: 'COMPLETED', label: 'Complete' },
    { status: 'CANCELLED', label: 'Cancel', variant: 'outline' },
  ],
  COMPLETED: [],
  CANCELLED: [],
};

function paidAmount(order: Order) {
  let paid = 0;
  for (const p of order.payments) {
    const amount = Number(p.amount);
    if (p.status === 'COMPLETED') paid += amount;
    else if (p.status === 'REFUNDED') paid -= amount;
  }
  return paid;
}

export function OrderBoard({ branches }: { branches: Branch[] }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Record<string, string>>({});
  const [payingId, setPayingId] = useState<string | null>(null);

  const load = useCallback(async (id: string, status: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const qs = status ? `?status=${status}` : '';
      const res = await fetch(`/api/branches/${id}/orders${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load orders.');
      setOrders(data.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(branchId, statusFilter);
  }, [branchId, statusFilter, load]);

  async function changeStatus(orderId: string, status: string, cancellationReason?: string) {
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, cancellationReason }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not update order status.');
      return;
    }
    setCancelling((c) => {
      const next = { ...c };
      delete next[orderId];
      return next;
    });
    load(branchId, statusFilter);
  }

  async function recordPayment(orderId: string, method: string, amount: string, note: string) {
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/orders/${orderId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, amount, note: note || undefined }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not record payment.');
      return;
    }
    setPayingId(null);
    load(branchId, statusFilter);
  }

  async function issueInvoice(orderId: string) {
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/orders/${orderId}/invoice`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not issue invoice.');
      return;
    }
    load(branchId, statusFilter);
  }

  if (branches.length === 0) {
    return <p className="text-sm text-muted-foreground">No branches yet — add one under Settings first.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="orderBranchSelect" className="text-sm">
          Branch
        </Label>
        <select
          id="orderBranchSelect"
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

        <Label htmlFor="orderStatusFilter" className="text-sm">
          Status
        </Label>
        <select
          id="orderStatusFilter"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All</option>
          {['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <NewOrderForm branchId={branchId} onCreated={() => load(branchId, statusFilter)} />

      <div className="space-y-3">
        {orders.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">No orders match this filter.</p>
        )}
        {orders.map((o) => {
          const paid = paidAmount(o);
          const balance = Number(o.total) - paid;
          return (
            <Card key={o.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span>
                    {o.type.replace(/_/g, ' ')} {o.table ? `· Table ${o.table.tableNumber}` : ''}
                    {o.guestName ? ` · ${o.guestName}` : ''}
                  </span>
                  <OrderStatusBadge status={o.status} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-1 text-sm">
                  {o.items.map((item) => (
                    <li key={item.id} className="flex justify-between text-muted-foreground">
                      <span>
                        {item.quantity}× {item.nameSnapshot}
                        {item.modifiers.length > 0 && (
                          <span className="text-xs"> ({item.modifiers.map((m) => m.nameSnapshot).join(', ')})</span>
                        )}
                      </span>
                      <span>₱{item.lineTotal}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-between border-t pt-2 text-sm">
                  <span className="text-muted-foreground">
                    Subtotal ₱{o.subtotal} · Tax ₱{o.taxTotal}
                    {Number(o.discountTotal) > 0 && ` · Discount -₱${o.discountTotal}`}
                  </span>
                  <span className="font-medium">Total ₱{o.total}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <span className="text-xs text-muted-foreground">
                    Paid ₱{paid.toFixed(2)} · Balance ₱{balance.toFixed(2)}
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={() => setPayingId(payingId === o.id ? null : o.id)}>
                    {payingId === o.id ? 'Close' : 'Record payment'}
                  </Button>
                  {balance <= 0 && (
                    <Button type="button" size="sm" variant="outline" onClick={() => issueInvoice(o.id)}>
                      Issue invoice
                    </Button>
                  )}
                </div>

                {payingId === o.id && <PaymentForm orderId={o.id} onSubmit={recordPayment} />}

                {cancelling[o.id] !== undefined ? (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    <Input
                      placeholder="Reason for cancellation"
                      className="max-w-xs"
                      value={cancelling[o.id]}
                      onChange={(e) => setCancelling((c) => ({ ...c, [o.id]: e.target.value }))}
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!cancelling[o.id]?.trim()}
                      onClick={() => changeStatus(o.id, 'CANCELLED', cancelling[o.id])}
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
                          delete next[o.id];
                          return next;
                        })
                      }
                    >
                      Back
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    {(NEXT_STATUS_ACTIONS[o.status] ?? []).map((action) =>
                      action.status === 'CANCELLED' ? (
                        <Button
                          key={action.status}
                          type="button"
                          size="sm"
                          variant={action.variant ?? 'default'}
                          onClick={() => setCancelling((c) => ({ ...c, [o.id]: '' }))}
                        >
                          {action.label}
                        </Button>
                      ) : (
                        <Button
                          key={action.status}
                          type="button"
                          size="sm"
                          variant={action.variant ?? 'default'}
                          onClick={() => changeStatus(o.id, action.status)}
                        >
                          {action.label}
                        </Button>
                      ),
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function PaymentForm({
  orderId,
  onSubmit,
}: {
  orderId: string;
  onSubmit: (orderId: string, method: string, amount: string, note: string) => void;
}) {
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  return (
    <div className="flex flex-wrap items-end gap-2 border-t pt-3">
      <div className="space-y-1">
        <Label className="text-xs">Method</Label>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          {['CASH', 'CARD', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'].map((m) => (
            <option key={m} value={m}>
              {m.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Amount (₱)</Label>
        <Input className="w-24" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="flex-1 space-y-1">
        <Label className="text-xs">Note</Label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Button type="button" size="sm" disabled={!amount} onClick={() => onSubmit(orderId, method, amount, note)}>
        Save
      </Button>
    </div>
  );
}

function NewOrderForm({ branchId, onCreated }: { branchId: string; onCreated: () => void }) {
  const [type, setType] = useState<'DINE_IN' | 'TAKEOUT' | 'DELIVERY'>('DINE_IN');
  const [tables, setTables] = useState<TableRow[]>([]);
  const [tableId, setTableId] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [notes, setNotes] = useState('');

  const [menuItems, setMenuItems] = useState<MenuItemRow[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/menu/items')
      .then((r) => r.json())
      .then((d) => setMenuItems(d.items ?? []))
      .catch(() => setMenuItems([]));
  }, []);

  useEffect(() => {
    if (!branchId) return;
    fetch(`/api/branches/${branchId}/tables`)
      .then((r) => r.json())
      .then((d) => setTables(d.tables ?? []))
      .catch(() => setTables([]));
  }, [branchId]);

  const estimatedTotal = useMemo(
    () => cart.reduce((sum, line) => sum + (line.unitPrice + line.modifiersUnitTotal) * line.quantity, 0),
    [cart],
  );

  function addLine(line: CartLine) {
    setCart((c) => [...c, line]);
  }
  function removeLine(key: string) {
    setCart((c) => c.filter((l) => l.key !== key));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!branchId || cart.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/branches/${branchId}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          tableId: type === 'DINE_IN' && tableId ? tableId : undefined,
          deliveryAddress: type === 'DELIVERY' ? deliveryAddress : undefined,
          guestName: guestName || undefined,
          guestPhone: guestPhone || undefined,
          notes: notes || undefined,
          items: cart.map((l) => ({
            menuItemId: l.menuItemId,
            menuItemVariantId: l.menuItemVariantId,
            quantity: l.quantity,
            modifierIds: l.modifierIds,
            notes: l.notes || undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not create order.');
        return;
      }
      setCart([]);
      setGuestName('');
      setGuestPhone('');
      setDeliveryAddress('');
      setNotes('');
      setTableId('');
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New order</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="DINE_IN">Dine-in</option>
              <option value="TAKEOUT">Takeout</option>
              <option value="DELIVERY">Delivery</option>
            </select>
          </div>
          {type === 'DINE_IN' && (
            <div className="space-y-1">
              <Label className="text-xs">Table (optional)</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={tableId}
                onChange={(e) => setTableId(e.target.value)}
              >
                <option value="">— none —</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    Table {t.tableNumber} ({t.status.replace(/_/g, ' ')})
                  </option>
                ))}
              </select>
            </div>
          )}
          {type === 'DELIVERY' && (
            <div className="min-w-[220px] flex-1 space-y-1">
              <Label className="text-xs">Delivery address</Label>
              <Input required value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Guest name (optional)</Label>
            <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phone (optional)</Label>
            <Input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
          </div>
        </div>

        <MenuItemPicker menuItems={menuItems} onAdd={addLine} />

        {cart.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">Order items:</p>
            <ul className="space-y-1 text-sm">
              {cart.map((line) => (
                <li key={line.key} className="flex items-center justify-between">
                  <span>
                    {line.quantity}× {line.label}
                    {line.modifiersLabel && <span className="text-xs text-muted-foreground"> ({line.modifiersLabel})</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    ₱{((line.unitPrice + line.modifiersUnitTotal) * line.quantity).toFixed(2)}
                    <button type="button" className="text-xs text-destructive" onClick={() => removeLine(line.key)}>
                      remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-right text-sm text-muted-foreground">
              Estimated total (before tax): ₱{estimatedTotal.toFixed(2)} — final pricing is computed by the server.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Order notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="button" disabled={submitting} onClick={onSubmit}>
              {submitting ? 'Placing order…' : `Place order (${cart.length} item${cart.length === 1 ? '' : 's'})`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MenuItemPicker({ menuItems, onAdd }: { menuItems: MenuItemRow[]; onAdd: (line: CartLine) => void }) {
  const [selectedItemId, setSelectedItemId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [lineNotes, setLineNotes] = useState('');

  const selectedItem = menuItems.find((m) => m.id === selectedItemId) ?? null;
  const groups = selectedItem?.modifierGroups.map((l) => l.modifierGroup) ?? [];

  function resetConfig() {
    setVariantId('');
    setQuantity(1);
    setSelectedModifierIds([]);
    setLineNotes('');
  }

  function toggleModifier(group: ModifierGroup, modifierId: string) {
    setSelectedModifierIds((ids) => {
      if (group.selectionType === 'SINGLE') {
        const withoutGroup = ids.filter((id) => !group.modifiers.some((m) => m.id === id));
        return [...withoutGroup, modifierId];
      }
      return ids.includes(modifierId) ? ids.filter((id) => id !== modifierId) : [...ids, modifierId];
    });
  }

  function handleAdd() {
    if (!selectedItem) return;
    const variant = selectedItem.variants.find((v) => v.id === variantId);
    const unitPrice = Number(variant ? variant.price : selectedItem.price);
    const selectedMods = groups
      .flatMap((g) => g.modifiers)
      .filter((m) => selectedModifierIds.includes(m.id));
    const modifiersUnitTotal = selectedMods.reduce((sum, m) => sum + Number(m.priceDelta), 0);
    onAdd({
      key: `${selectedItem.id}-${Date.now()}`,
      menuItemId: selectedItem.id,
      label: variant ? `${selectedItem.name} (${variant.name})` : selectedItem.name,
      unitPrice,
      quantity,
      modifierIds: selectedModifierIds,
      modifiersLabel: selectedMods.map((m) => m.name).join(', '),
      modifiersUnitTotal,
      menuItemVariantId: variant?.id,
      notes: lineNotes || undefined,
    });
    setSelectedItemId('');
    resetConfig();
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1 space-y-1">
          <Label className="text-xs">Add item</Label>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={selectedItemId}
            onChange={(e) => {
              setSelectedItemId(e.target.value);
              resetConfig();
            }}
          >
            <option value="">— select a menu item —</option>
            {menuItems
              .filter((m) => m.active && m.available)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.category ? `${m.category.name} — ` : ''}
                  {m.name} (₱{m.price})
                </option>
              ))}
          </select>
        </div>
        {selectedItem && (
          <div className="space-y-1">
            <Label className="text-xs">Qty</Label>
            <Input
              type="number"
              className="w-16"
              min={1}
              max={50}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </div>
        )}
      </div>

      {selectedItem && (
        <div className="space-y-3 rounded-md border p-3">
          {selectedItem.variants.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">Variant</p>
              <div className="flex flex-wrap gap-2">
                {selectedItem.variants
                  .filter((v) => v.active)
                  .map((v) => (
                    <label key={v.id} className="flex items-center gap-1 text-xs">
                      <input
                        type="radio"
                        name="variant"
                        checked={variantId === v.id}
                        onChange={() => setVariantId(v.id)}
                      />
                      {v.name} (₱{v.price})
                    </label>
                  ))}
              </div>
            </div>
          )}

          {groups.map((group) => (
            <div key={group.id} className="space-y-1">
              <p className="text-xs font-medium">
                {group.name} {group.required && <span className="text-destructive">*</span>}
                <span className="text-muted-foreground"> ({group.selectionType === 'SINGLE' ? 'choose one' : `choose up to ${group.maxSelect}`})</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {group.modifiers
                  .filter((m) => m.active)
                  .map((m) => (
                    <label key={m.id} className="flex items-center gap-1 text-xs">
                      <input
                        type={group.selectionType === 'SINGLE' ? 'radio' : 'checkbox'}
                        name={`group-${group.id}`}
                        checked={selectedModifierIds.includes(m.id)}
                        onChange={() => toggleModifier(group, m.id)}
                      />
                      {m.name} {Number(m.priceDelta) > 0 && `(+₱${m.priceDelta})`}
                    </label>
                  ))}
              </div>
            </div>
          ))}

          <div className="space-y-1">
            <Label className="text-xs">Item notes (optional)</Label>
            <Input value={lineNotes} onChange={(e) => setLineNotes(e.target.value)} placeholder="e.g. no onions" />
          </div>

          <Button type="button" size="sm" onClick={handleAdd}>
            Add to order
          </Button>
        </div>
      )}
    </div>
  );
}
