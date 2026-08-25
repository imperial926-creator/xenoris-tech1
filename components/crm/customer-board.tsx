'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
}
interface Address {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string | null;
  isDefault: boolean;
}
interface Preference {
  id: string;
  key: string;
  value: string;
}
interface Note {
  id: string;
  note: string;
  createdAt: string;
}
interface Tag {
  id: string;
  tag: string;
}
interface Review {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}
interface CustomerProfile extends Customer {
  addresses: Address[];
  preferences: Preference[];
  notes: Note[];
  tags: Tag[];
}
interface FavoriteProduct {
  menuItemId: string;
  name: string;
  quantity: number;
}
interface Analytics {
  totalOrders: number;
  totalReservations: number;
  totalCateringOrders: number;
  totalSpending: string;
  averageOrderValue: string;
  firstTransactionAt: string | null;
  lastTransactionAt: string | null;
  visitFrequencyDays: number | null;
  favoriteProducts: FavoriteProduct[];
  rfm: { recencyDays: number | null; frequency: number; monetary: string; segment: string };
}

const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'];
const SEGMENTS = ['NEW', 'RETURNING', 'REGULAR', 'VIP', 'AT_RISK', 'INACTIVE', 'HIGH_VALUE'];
const EMPTY_CUSTOMER_FORM = { firstName: '', lastName: '', email: '', phone: '' };

export function CustomerBoard() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [segments, setSegments] = useState<Record<string, number> | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [customerForm, setCustomerForm] = useState(EMPTY_CUSTOMER_FORM);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);

  const [addressForm, setAddressForm] = useState({ label: '', line1: '', city: '' });
  const [preferenceForm, setPreferenceForm] = useState({ key: '', value: '' });
  const [noteForm, setNoteForm] = useState('');
  const [tagForm, setTagForm] = useState('');
  const [reviewForm, setReviewForm] = useState({ rating: '5', comment: '' });

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      const [customersRes, segmentsRes] = await Promise.all([
        fetch(`/api/customers?${params.toString()}`),
        fetch('/api/customers/segments'),
      ]);
      const [customersData, segmentsData] = await Promise.all([customersRes.json(), segmentsRes.json()]);
      if (!customersRes.ok) throw new Error(customersData.error ?? 'Failed to load customers.');
      if (!segmentsRes.ok) throw new Error(segmentsData.error ?? 'Failed to load segment breakdown.');
      setCustomers(customersData.customers);
      setSegments(segmentsData.segments);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }, [search, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function createCustomer() {
    setError(null);
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: customerForm.firstName,
        lastName: customerForm.lastName || undefined,
        email: customerForm.email || undefined,
        phone: customerForm.phone || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not create customer.');
    setCustomerForm(EMPTY_CUSTOMER_FORM);
    load();
  }

  const loadProfile = useCallback(async (customerId: string) => {
    setError(null);
    try {
      // GET /api/customers/[id] includes reviews directly (CustomerService's
      // PROFILE_INCLUDE) — no separate reviews fetch needed.
      const [profileRes, analyticsRes] = await Promise.all([
        fetch(`/api/customers/${customerId}`),
        fetch(`/api/customers/${customerId}/analytics`),
      ]);
      const [profileData, analyticsData] = await Promise.all([profileRes.json(), analyticsRes.json()]);
      if (!profileRes.ok) throw new Error(profileData.error ?? 'Failed to load customer profile.');
      if (!analyticsRes.ok) throw new Error(analyticsData.error ?? 'Failed to load analytics.');
      setProfile(profileData.customer);
      setAnalytics(analyticsData.analytics);
      setReviews(profileData.customer.reviews ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }, []);

  function toggleProfile(customer: Customer) {
    if (expandedId === customer.id) {
      setExpandedId(null);
      setProfile(null);
      setAnalytics(null);
      return;
    }
    setExpandedId(customer.id);
    loadProfile(customer.id);
  }

  async function addAddress(customerId: string) {
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/addresses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: addressForm.label || undefined, line1: addressForm.line1, city: addressForm.city || undefined }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not add address.');
    setAddressForm({ label: '', line1: '', city: '' });
    loadProfile(customerId);
  }

  async function deleteAddress(customerId: string, addressId: string) {
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/addresses/${addressId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not delete address.');
    loadProfile(customerId);
  }

  async function setPreference(customerId: string) {
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferenceForm),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not save preference.');
    setPreferenceForm({ key: '', value: '' });
    loadProfile(customerId);
  }

  async function removePreference(customerId: string, key: string) {
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/preferences/${encodeURIComponent(key)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not remove preference.');
    loadProfile(customerId);
  }

  async function addNote(customerId: string) {
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: noteForm }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not add note.');
    setNoteForm('');
    loadProfile(customerId);
  }

  async function addTag(customerId: string) {
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: tagForm }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not add tag.');
    setTagForm('');
    loadProfile(customerId);
  }

  async function removeTag(customerId: string, tag: string) {
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not remove tag.');
    loadProfile(customerId);
  }

  async function addReview(customerId: string) {
    setError(null);
    const res = await fetch('/api/customer-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId, rating: Number(reviewForm.rating), comment: reviewForm.comment || undefined }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? 'Could not record review.');
    setReviewForm({ rating: '5', comment: '' });
    setReviews((r) => [data.review, ...r]);
  }

  return (
    <div className="space-y-8">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Segments</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {SEGMENTS.map((seg) => (
              <div key={seg} className="rounded-md border p-2 text-center">
                <p className="text-lg font-semibold">{segments?.[seg] ?? '—'}</p>
                <p className="text-xs text-muted-foreground">{seg}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">New customer</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="custFirstName" className="text-xs">First name</Label>
              <Input id="custFirstName" className="w-40" value={customerForm.firstName} onChange={(e) => setCustomerForm((f) => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="custLastName" className="text-xs">Last name</Label>
              <Input id="custLastName" className="w-40" value={customerForm.lastName} onChange={(e) => setCustomerForm((f) => ({ ...f, lastName: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="custEmail" className="text-xs">Email</Label>
              <Input id="custEmail" className="w-56" value={customerForm.email} onChange={(e) => setCustomerForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="custPhone" className="text-xs">Phone</Label>
              <Input id="custPhone" className="w-40" value={customerForm.phone} onChange={(e) => setCustomerForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <Button size="sm" onClick={createCustomer} disabled={!customerForm.firstName}>Add customer</Button>
          </div>
        </CardContent>
      </Card>

      <div>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <h2 className="text-base font-semibold">Customers</h2>
          <div>
            <Label htmlFor="custSearch" className="text-xs">Search</Label>
            <Input id="custSearch" className="w-56" placeholder="Name, email, or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="custStatusFilter" className="text-xs">Status</Label>
            <select
              id="custStatusFilter"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              {CUSTOMER_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-3">
          {customers.length === 0 && <p className="text-sm text-muted-foreground">No customers yet.</p>}
          {customers.map((c) => (
            <Card key={c.id}>
              <CardContent className="space-y-2 pt-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{c.firstName} {c.lastName ?? ''}</span>
                  <span className="text-xs text-muted-foreground">{c.status}</span>
                </div>
                <p className="text-muted-foreground">{c.email ?? 'no email'} · {c.phone ?? 'no phone'}</p>
                <Button size="sm" variant="outline" onClick={() => toggleProfile(c)}>
                  {expandedId === c.id ? 'Close profile' : 'View profile'}
                </Button>

                {expandedId === c.id && profile && analytics && (
                  <div className="mt-2 space-y-4 rounded-md border p-3">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat label="Segment" value={analytics.rfm.segment} />
                      <Stat label="Total spend" value={`₱${analytics.totalSpending}`} />
                      <Stat label="Orders" value={String(analytics.totalOrders)} />
                      <Stat label="Reservations" value={String(analytics.totalReservations)} />
                      <Stat label="Catering events" value={String(analytics.totalCateringOrders)} />
                      <Stat label="Avg order value" value={`₱${analytics.averageOrderValue}`} />
                      <Stat label="Last transaction" value={analytics.lastTransactionAt ? new Date(analytics.lastTransactionAt).toLocaleDateString() : '—'} />
                      <Stat label="Visit frequency" value={analytics.visitFrequencyDays !== null ? `every ~${analytics.visitFrequencyDays}d` : '—'} />
                    </div>

                    {analytics.favoriteProducts.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Favorite products</p>
                        <p className="text-sm">{analytics.favoriteProducts.map((p) => `${p.name} (${p.quantity})`).join(', ')}</p>
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Addresses</p>
                        {profile.addresses.map((a) => (
                          <div key={a.id} className="flex items-center justify-between gap-2 text-xs">
                            <span>{a.label ? `${a.label}: ` : ''}{a.line1}{a.city ? `, ${a.city}` : ''}{a.isDefault ? ' (default)' : ''}</span>
                            <Button size="sm" variant="outline" onClick={() => deleteAddress(c.id, a.id)}>Remove</Button>
                          </div>
                        ))}
                        <div className="flex flex-wrap items-end gap-2">
                          <Input placeholder="Label" className="h-8 w-20 text-xs" value={addressForm.label} onChange={(e) => setAddressForm((f) => ({ ...f, label: e.target.value }))} />
                          <Input placeholder="Address line" className="h-8 flex-1 text-xs" value={addressForm.line1} onChange={(e) => setAddressForm((f) => ({ ...f, line1: e.target.value }))} />
                          <Input placeholder="City" className="h-8 w-24 text-xs" value={addressForm.city} onChange={(e) => setAddressForm((f) => ({ ...f, city: e.target.value }))} />
                          <Button size="sm" onClick={() => addAddress(c.id)} disabled={!addressForm.line1}>Add</Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Preferences</p>
                        {profile.preferences.map((p) => (
                          <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                            <span>{p.key}: {p.value}</span>
                            <Button size="sm" variant="outline" onClick={() => removePreference(c.id, p.key)}>Remove</Button>
                          </div>
                        ))}
                        <div className="flex flex-wrap items-end gap-2">
                          <Input placeholder="Key (e.g. dietary)" className="h-8 w-32 text-xs" value={preferenceForm.key} onChange={(e) => setPreferenceForm((f) => ({ ...f, key: e.target.value }))} />
                          <Input placeholder="Value" className="h-8 w-32 text-xs" value={preferenceForm.value} onChange={(e) => setPreferenceForm((f) => ({ ...f, value: e.target.value }))} />
                          <Button size="sm" onClick={() => setPreference(c.id)} disabled={!preferenceForm.key || !preferenceForm.value}>Save</Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Tags</p>
                        <div className="flex flex-wrap gap-1">
                          {profile.tags.map((t) => (
                            <span key={t.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                              {t.tag}
                              <button type="button" className="text-muted-foreground" onClick={() => removeTag(c.id, t.tag)} aria-label={`Remove ${t.tag}`}>×</button>
                            </span>
                          ))}
                        </div>
                        <div className="flex items-end gap-2">
                          <Input placeholder="New tag" className="h-8 w-32 text-xs" value={tagForm} onChange={(e) => setTagForm(e.target.value)} />
                          <Button size="sm" onClick={() => addTag(c.id)} disabled={!tagForm}>Add tag</Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Notes</p>
                        {profile.notes.map((n) => (
                          <p key={n.id} className="text-xs">{n.note} <span className="text-muted-foreground">— {new Date(n.createdAt).toLocaleDateString()}</span></p>
                        ))}
                        <div className="flex items-end gap-2">
                          <Input placeholder="Add a note" className="h-8 flex-1 text-xs" value={noteForm} onChange={(e) => setNoteForm(e.target.value)} />
                          <Button size="sm" onClick={() => addNote(c.id)} disabled={!noteForm}>Save</Button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Reviews</p>
                      {reviews.map((r) => (
                        <p key={r.id} className="text-xs">★{r.rating} {r.comment ?? ''} <span className="text-muted-foreground">— {new Date(r.createdAt).toLocaleDateString()}</span></p>
                      ))}
                      <div className="flex flex-wrap items-end gap-2">
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          value={reviewForm.rating}
                          onChange={(e) => setReviewForm((f) => ({ ...f, rating: e.target.value }))}
                        >
                          {[5, 4, 3, 2, 1].map((n) => (
                            <option key={n} value={n}>{n} star{n === 1 ? '' : 's'}</option>
                          ))}
                        </select>
                        <Input placeholder="Comment (optional)" className="h-8 flex-1 text-xs" value={reviewForm.comment} onChange={(e) => setReviewForm((f) => ({ ...f, comment: e.target.value }))} />
                        <Button size="sm" onClick={() => addReview(c.id)}>Record review</Button>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-sm font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
