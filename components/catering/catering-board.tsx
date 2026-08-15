'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Branch {
  id: string;
  name: string;
}
interface Package {
  id: string;
  name: string;
  pricePerGuest: string;
  active: boolean;
}
interface Inquiry {
  id: string;
  guestName: string | null;
  guestPhone: string | null;
  eventType: string;
  eventDate: string;
  location: string;
  guestCount: number;
  status: string;
  packageId: string | null;
}
interface QuoteItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}
interface Quote {
  id: string;
  inquiryId: string;
  guestCount: number;
  foodTotal: string;
  staffingTotal: string;
  equipmentTotal: string;
  transportationTotal: string;
  setupTotal: string;
  serviceFeeTotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  status: string;
  rejectionReason: string | null;
  cancellationReason: string | null;
  items: QuoteItem[];
  inquiry: { eventType: string; guestName: string | null };
}
interface CateringPayment {
  id: string;
  type: string;
  method: string;
  amount: string;
  status: string;
  note: string | null;
}
interface CateringEvent {
  id: string;
  quoteId: string;
  guestName: string | null;
  eventType: string;
  eventDate: string;
  location: string;
  guestCount: number;
  status: string;
  total: string;
  depositAmount: string;
  payments: CateringPayment[];
}

const QUOTE_STATUS_ACTIONS: Record<string, { status: string; label: string; variant?: 'default' | 'outline'; needsReason?: 'rejectionReason' | 'cancellationReason' }[]> = {
  DRAFT: [{ status: 'SENT', label: 'Send to customer' }, { status: 'CANCELLED', label: 'Cancel', variant: 'outline', needsReason: 'cancellationReason' }],
  SENT: [
    { status: 'VIEWED', label: 'Mark viewed', variant: 'outline' },
    { status: 'ACCEPTED', label: 'Accept (creates event)' },
    { status: 'REJECTED', label: 'Reject', variant: 'outline', needsReason: 'rejectionReason' },
    { status: 'CANCELLED', label: 'Cancel', variant: 'outline', needsReason: 'cancellationReason' },
  ],
  VIEWED: [
    { status: 'ACCEPTED', label: 'Accept (creates event)' },
    { status: 'REJECTED', label: 'Reject', variant: 'outline', needsReason: 'rejectionReason' },
    { status: 'CANCELLED', label: 'Cancel', variant: 'outline', needsReason: 'cancellationReason' },
  ],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

const EVENT_STATUS_ACTIONS: Record<string, { status: string; label: string; variant?: 'default' | 'outline'; needsReason?: boolean }[]> = {
  SCHEDULED: [{ status: 'IN_PROGRESS', label: 'Start event' }, { status: 'CANCELLED', label: 'Cancel', variant: 'outline', needsReason: true }],
  IN_PROGRESS: [{ status: 'COMPLETED', label: 'Complete' }, { status: 'CANCELLED', label: 'Cancel', variant: 'outline', needsReason: true }],
  COMPLETED: [],
  CANCELLED: [],
};

const EMPTY_INQUIRY_FORM = { guestName: '', eventType: '', eventDate: '', location: '', guestCount: '20', packageId: '' };
const EMPTY_QUOTE_ITEM = { description: '', quantity: '1', unitPrice: '0.00' };

function paymentSummary(event: CateringEvent) {
  let paid = 0;
  for (const p of event.payments) {
    const amount = Number(p.amount);
    if (p.status === 'COMPLETED') paid += amount;
    else if (p.status === 'REFUNDED') paid -= amount;
  }
  const balanceDue = Number(event.total) - paid;
  return { paid: paid.toFixed(2), balanceDue: balanceDue.toFixed(2), isFullyPaid: balanceDue <= 0 };
}

export function CateringBoard({ branches }: { branches: Branch[] }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [packages, setPackages] = useState<Package[]>([]);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [events, setEvents] = useState<CateringEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [packageForm, setPackageForm] = useState({ name: '', pricePerGuest: '0.00' });
  const [inquiryForm, setInquiryForm] = useState(EMPTY_INQUIRY_FORM);
  const [openQuoteBuilder, setOpenQuoteBuilder] = useState<string | null>(null);
  const [quoteBuilder, setQuoteBuilder] = useState({
    guestCount: '20',
    items: [{ ...EMPTY_QUOTE_ITEM }],
    staffingTotal: '0.00',
    equipmentTotal: '0.00',
    transportationTotal: '0.00',
    setupTotal: '0.00',
    serviceFeeTotal: '0.00',
    discountTotal: '0.00',
  });
  const [quoteReasons, setQuoteReasons] = useState<Record<string, string>>({});
  const [eventReasons, setEventReasons] = useState<Record<string, string>>({});
  const [paymentForms, setPaymentForms] = useState<Record<string, { type: string; method: string; amount: string; note: string }>>({});

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setError(null);
    try {
      const [pkgRes, inqRes, quoteRes, eventRes] = await Promise.all([
        fetch(`/api/branches/${id}/catering/packages`),
        fetch(`/api/branches/${id}/catering/inquiries`),
        fetch(`/api/branches/${id}/catering/quotes`),
        fetch(`/api/branches/${id}/catering/events`),
      ]);
      const [pkgData, inqData, quoteData, eventData] = await Promise.all([pkgRes.json(), inqRes.json(), quoteRes.json(), eventRes.json()]);
      if (!pkgRes.ok) throw new Error(pkgData.error ?? 'Failed to load packages.');
      if (!inqRes.ok) throw new Error(inqData.error ?? 'Failed to load inquiries.');
      if (!quoteRes.ok) throw new Error(quoteData.error ?? 'Failed to load quotes.');
      if (!eventRes.ok) throw new Error(eventData.error ?? 'Failed to load events.');
      setPackages(pkgData.packages);
      setInquiries(inqData.inquiries);
      setQuotes(quoteData.quotes);
      setEvents(eventData.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }, []);

  useEffect(() => {
    load(branchId);
  }, [branchId, load]);

  async function createPackage() {
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/catering/packages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(packageForm),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not create package.');
    setPackageForm({ name: '', pricePerGuest: '0.00' });
    load(branchId);
  }

  async function createInquiry() {
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/catering/inquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...inquiryForm,
        guestCount: Number(inquiryForm.guestCount),
        packageId: inquiryForm.packageId || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not create inquiry.');
    setInquiryForm(EMPTY_INQUIRY_FORM);
    load(branchId);
  }

  async function cancelInquiry(inquiryId: string) {
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/catering/inquiries/${inquiryId}/cancel`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not cancel inquiry.');
    load(branchId);
  }

  function toggleQuoteBuilder(inquiry: Inquiry) {
    if (openQuoteBuilder === inquiry.id) {
      setOpenQuoteBuilder(null);
      return;
    }
    setOpenQuoteBuilder(inquiry.id);
    setQuoteBuilder({
      guestCount: String(inquiry.guestCount),
      items: [{ ...EMPTY_QUOTE_ITEM }],
      staffingTotal: '0.00',
      equipmentTotal: '0.00',
      transportationTotal: '0.00',
      setupTotal: '0.00',
      serviceFeeTotal: '0.00',
      discountTotal: '0.00',
    });
  }

  async function createQuote(inquiryId: string) {
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/catering/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inquiryId,
        guestCount: Number(quoteBuilder.guestCount),
        items: quoteBuilder.items
          .filter((i) => i.description.trim())
          .map((i) => ({ description: i.description, quantity: Number(i.quantity), unitPrice: i.unitPrice })),
        staffingTotal: quoteBuilder.staffingTotal,
        equipmentTotal: quoteBuilder.equipmentTotal,
        transportationTotal: quoteBuilder.transportationTotal,
        setupTotal: quoteBuilder.setupTotal,
        serviceFeeTotal: quoteBuilder.serviceFeeTotal,
        discountTotal: quoteBuilder.discountTotal,
      }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not create quote.');
    setOpenQuoteBuilder(null);
    load(branchId);
  }

  async function changeQuoteStatus(quoteId: string, status: string, needsReason?: 'rejectionReason' | 'cancellationReason') {
    setError(null);
    const reason = quoteReasons[quoteId];
    if (needsReason && !reason) {
      setError(`A reason is required to ${status === 'REJECTED' ? 'reject' : 'cancel'} this quote.`);
      return;
    }
    const body: Record<string, string> = { status };
    if (needsReason) body[needsReason] = reason;
    const res = await fetch(`/api/branches/${branchId}/catering/quotes/${quoteId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not update quote status.');
    setQuoteReasons((r) => { const next = { ...r }; delete next[quoteId]; return next; });
    load(branchId);
  }

  async function changeEventStatus(eventId: string, status: string, needsReason?: boolean) {
    setError(null);
    const reason = eventReasons[eventId];
    if (needsReason && !reason) {
      setError('A cancellationReason is required to cancel this event.');
      return;
    }
    const res = await fetch(`/api/branches/${branchId}/catering/events/${eventId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, cancellationReason: needsReason ? reason : undefined }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not update event status.');
    setEventReasons((r) => { const next = { ...r }; delete next[eventId]; return next; });
    load(branchId);
  }

  async function recordPayment(eventId: string) {
    const form = paymentForms[eventId];
    if (!form?.amount) return;
    setError(null);
    const res = await fetch(`/api/branches/${branchId}/catering/events/${eventId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: form.type, method: form.method, amount: form.amount, note: form.note || undefined }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not record payment.');
    setPaymentForms((f) => { const next = { ...f }; delete next[eventId]; return next; });
    load(branchId);
  }

  if (branches.length === 0) {
    return <p className="text-sm text-muted-foreground">No branches yet — add one under Settings first.</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="cateringBranchSelect" className="text-sm">Branch</Label>
        <select
          id="cateringBranchSelect"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Packages</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="pkgName" className="text-xs">Name</Label>
              <Input id="pkgName" className="w-48" value={packageForm.name} onChange={(e) => setPackageForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="pkgPrice" className="text-xs">Price per guest</Label>
              <Input id="pkgPrice" className="w-28" value={packageForm.pricePerGuest} onChange={(e) => setPackageForm((f) => ({ ...f, pricePerGuest: e.target.value }))} />
            </div>
            <Button size="sm" onClick={createPackage} disabled={!packageForm.name}>Add package</Button>
          </div>
          <ul className="space-y-1 text-sm">
            {packages.length === 0 && <li className="text-muted-foreground">No catering packages yet.</li>}
            {packages.map((p) => (
              <li key={p.id}>{p.name} — ₱{p.pricePerGuest}/guest {!p.active && <span className="text-muted-foreground">(inactive)</span>}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">New inquiry</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="inqGuestName" className="text-xs">Guest / contact name</Label>
              <Input id="inqGuestName" value={inquiryForm.guestName} onChange={(e) => setInquiryForm((f) => ({ ...f, guestName: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="inqEventType" className="text-xs">Event type</Label>
              <Input id="inqEventType" placeholder="Wedding, Corporate, ..." value={inquiryForm.eventType} onChange={(e) => setInquiryForm((f) => ({ ...f, eventType: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="inqEventDate" className="text-xs">Event date/time</Label>
              <Input id="inqEventDate" type="datetime-local" value={inquiryForm.eventDate} onChange={(e) => setInquiryForm((f) => ({ ...f, eventDate: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="inqLocation" className="text-xs">Location</Label>
              <Input id="inqLocation" value={inquiryForm.location} onChange={(e) => setInquiryForm((f) => ({ ...f, location: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="inqGuestCount" className="text-xs">Guest count</Label>
              <Input id="inqGuestCount" type="number" min={1} value={inquiryForm.guestCount} onChange={(e) => setInquiryForm((f) => ({ ...f, guestCount: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="inqPackage" className="text-xs">Package (optional)</Label>
              <select
                id="inqPackage"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={inquiryForm.packageId}
                onChange={(e) => setInquiryForm((f) => ({ ...f, packageId: e.target.value }))}
              >
                <option value="">None</option>
                {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <Button size="sm" onClick={createInquiry} disabled={!inquiryForm.eventType || !inquiryForm.eventDate || !inquiryForm.location || !inquiryForm.guestCount}>
            Log inquiry
          </Button>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-base font-semibold">Inquiries</h2>
        <div className="space-y-3">
          {inquiries.length === 0 && <p className="text-sm text-muted-foreground">No catering inquiries yet.</p>}
          {inquiries.map((inq) => (
            <Card key={inq.id}>
              <CardContent className="space-y-2 pt-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{inq.eventType} — {inq.guestName ?? 'Guest'}</span>
                  <span className="text-xs text-muted-foreground">{inq.status}</span>
                </div>
                <p className="text-muted-foreground">
                  {new Date(inq.eventDate).toLocaleString()} · {inq.location} · {inq.guestCount} guests
                </p>
                <div className="flex flex-wrap gap-2">
                  {(inq.status === 'NEW' || inq.status === 'QUOTED') && (
                    <Button size="sm" variant="outline" onClick={() => toggleQuoteBuilder(inq)}>
                      {openQuoteBuilder === inq.id ? 'Close quote builder' : 'Build quote'}
                    </Button>
                  )}
                  {inq.status !== 'CONVERTED' && inq.status !== 'CANCELLED' && (
                    <Button size="sm" variant="outline" onClick={() => cancelInquiry(inq.id)}>Cancel inquiry</Button>
                  )}
                </div>

                {openQuoteBuilder === inq.id && (
                  <div className="mt-2 space-y-3 rounded-md border p-3">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <div>
                        <Label className="text-xs">Guest count</Label>
                        <Input type="number" min={1} value={quoteBuilder.guestCount} onChange={(e) => setQuoteBuilder((q) => ({ ...q, guestCount: e.target.value }))} />
                      </div>
                      {(['staffingTotal', 'equipmentTotal', 'transportationTotal', 'setupTotal', 'serviceFeeTotal', 'discountTotal'] as const).map((key) => (
                        <div key={key}>
                          <Label className="text-xs">{key.replace('Total', '')}</Label>
                          <Input value={quoteBuilder[key]} onChange={(e) => setQuoteBuilder((q) => ({ ...q, [key]: e.target.value }))} />
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Food items</Label>
                      {quoteBuilder.items.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Input
                            placeholder="Description"
                            className="flex-1"
                            value={item.description}
                            onChange={(e) => setQuoteBuilder((q) => ({ ...q, items: q.items.map((it, i) => (i === idx ? { ...it, description: e.target.value } : it)) }))}
                          />
                          <Input
                            type="number"
                            min={1}
                            className="w-20"
                            value={item.quantity}
                            onChange={(e) => setQuoteBuilder((q) => ({ ...q, items: q.items.map((it, i) => (i === idx ? { ...it, quantity: e.target.value } : it)) }))}
                          />
                          <Input
                            className="w-28"
                            value={item.unitPrice}
                            onChange={(e) => setQuoteBuilder((q) => ({ ...q, items: q.items.map((it, i) => (i === idx ? { ...it, unitPrice: e.target.value } : it)) }))}
                          />
                        </div>
                      ))}
                      <Button size="sm" variant="outline" onClick={() => setQuoteBuilder((q) => ({ ...q, items: [...q.items, { ...EMPTY_QUOTE_ITEM }] }))}>
                        Add item
                      </Button>
                    </div>
                    <Button size="sm" onClick={() => createQuote(inq.id)}>Save draft quote</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold">Quotes</h2>
        <div className="space-y-3">
          {quotes.length === 0 && <p className="text-sm text-muted-foreground">No quotes yet.</p>}
          {quotes.map((q) => {
            const actions = QUOTE_STATUS_ACTIONS[q.status] ?? [];
            return (
              <Card key={q.id}>
                <CardContent className="space-y-2 pt-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{q.inquiry.eventType} — {q.inquiry.guestName ?? 'Guest'}</span>
                    <span className="text-xs text-muted-foreground">{q.status}</span>
                  </div>
                  <p>
                    Food ₱{q.foodTotal} + Staffing ₱{q.staffingTotal} + Equipment ₱{q.equipmentTotal} + Transport ₱{q.transportationTotal} + Setup ₱{q.setupTotal} + Service ₱{q.serviceFeeTotal} − Discount ₱{q.discountTotal} + Tax ₱{q.taxTotal} = <strong>₱{q.total}</strong>
                  </p>
                  {q.rejectionReason && <p className="text-destructive">Rejected: {q.rejectionReason}</p>}
                  {q.cancellationReason && <p className="text-muted-foreground">Cancelled: {q.cancellationReason}</p>}
                  {actions.some((a) => a.needsReason) && (
                    <Input
                      placeholder="Reason (required to reject/cancel)"
                      className="h-8 text-xs"
                      value={quoteReasons[q.id] ?? ''}
                      onChange={(e) => setQuoteReasons((r) => ({ ...r, [q.id]: e.target.value }))}
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    {actions.map((a) => (
                      <Button key={a.status} size="sm" variant={a.variant ?? 'default'} onClick={() => changeQuoteStatus(q.id, a.status, a.needsReason)}>
                        {a.label}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold">Events</h2>
        <div className="space-y-3">
          {events.length === 0 && <p className="text-sm text-muted-foreground">No catering events yet.</p>}
          {events.map((ev) => {
            const summary = paymentSummary(ev);
            const actions = EVENT_STATUS_ACTIONS[ev.status] ?? [];
            const paymentForm = paymentForms[ev.id] ?? { type: 'DEPOSIT', method: 'CASH', amount: '', note: '' };
            return (
              <Card key={ev.id}>
                <CardContent className="space-y-2 pt-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{ev.eventType} — {ev.guestName ?? 'Guest'}</span>
                    <span className="text-xs text-muted-foreground">{ev.status}</span>
                  </div>
                  <p className="text-muted-foreground">
                    {new Date(ev.eventDate).toLocaleString()} · {ev.location} · {ev.guestCount} guests
                  </p>
                  <p>
                    Total ₱{ev.total} · Deposit ₱{ev.depositAmount} · Paid ₱{summary.paid} · Balance due ₱{summary.balanceDue}{' '}
                    {summary.isFullyPaid && <span className="text-green-600">(fully paid)</span>}
                  </p>

                  {!summary.isFullyPaid && (ev.status === 'SCHEDULED' || ev.status === 'IN_PROGRESS' || ev.status === 'COMPLETED') && (
                    <div className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        value={paymentForm.type}
                        onChange={(e) => setPaymentForms((f) => ({ ...f, [ev.id]: { ...paymentForm, type: e.target.value } }))}
                      >
                        <option value="DEPOSIT">Deposit</option>
                        <option value="BALANCE">Balance</option>
                      </select>
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        value={paymentForm.method}
                        onChange={(e) => setPaymentForms((f) => ({ ...f, [ev.id]: { ...paymentForm, method: e.target.value } }))}
                      >
                        {['CASH', 'CARD', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'].map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <Input
                        placeholder="Amount"
                        className="h-8 w-28 text-xs"
                        value={paymentForm.amount}
                        onChange={(e) => setPaymentForms((f) => ({ ...f, [ev.id]: { ...paymentForm, amount: e.target.value } }))}
                      />
                      <Button size="sm" variant="outline" onClick={() => recordPayment(ev.id)}>Record payment</Button>
                    </div>
                  )}

                  {actions.some((a) => a.needsReason) && (
                    <Input
                      placeholder="Cancellation reason"
                      className="h-8 text-xs"
                      value={eventReasons[ev.id] ?? ''}
                      onChange={(e) => setEventReasons((r) => ({ ...r, [ev.id]: e.target.value }))}
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    {actions.map((a) => (
                      <Button key={a.status} size="sm" variant={a.variant ?? 'default'} onClick={() => changeEventStatus(ev.id, a.status, a.needsReason)}>
                        {a.label}
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
