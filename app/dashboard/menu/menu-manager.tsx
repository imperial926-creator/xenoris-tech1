'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface Category {
  id: string;
  name: string;
}
interface ModifierGroup {
  id: string;
  name: string;
  selectionType: string;
  modifiers: { id: string; name: string; priceDelta: string }[];
}
interface MenuItemRow {
  id: string;
  name: string;
  price: string;
  available: boolean;
  category: Category;
  modifierGroups: { modifierGroup: ModifierGroup }[];
}

async function fetchJson(url: string) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}

export function MenuManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItemRow[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, i, m] = await Promise.all([
        fetchJson('/api/menu/categories'),
        fetchJson('/api/menu/items'),
        fetchJson('/api/menu/modifier-groups'),
      ]);
      setCategories(c.categories);
      setItems(i.items);
      setModifierGroups(m.groups);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load menu.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Categories</CardTitle>
          <CardDescription>{categories.length} categor{categories.length === 1 ? 'y' : 'ies'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.id} className="rounded-full border px-3 py-1 text-sm">
                {c.name}
              </li>
            ))}
          </ul>
          <AddCategoryForm onCreated={load} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Menu items</CardTitle>
          <CardDescription>{items.length} item{items.length === 1 ? '' : 's'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="divide-y rounded-md border">
            {items.length === 0 && <li className="p-3 text-sm text-muted-foreground">No menu items yet.</li>}
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.category.name}
                    {item.modifierGroups.length > 0 &&
                      ` · ${item.modifierGroups.map((l) => l.modifierGroup.name).join(', ')}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">₱{item.price}</span>
                  {!item.available && (
                    <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      Unavailable
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <AddItemForm categories={categories} onCreated={load} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modifier groups</CardTitle>
          <CardDescription>
            e.g. &quot;Size&quot; (choose one) or &quot;Add-ons&quot; (choose any) — link to items above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2">
            {modifierGroups.map((g) => (
              <li key={g.id} className="rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {g.name} <span className="text-xs text-muted-foreground">({g.selectionType.toLowerCase()})</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {g.modifiers.length === 0
                    ? 'No modifiers yet.'
                    : g.modifiers.map((m) => `${m.name} (+₱${m.priceDelta})`).join(', ')}
                </p>
                <AddModifierForm groupId={g.id} onCreated={load} />
              </li>
            ))}
          </ul>
          <AddModifierGroupForm onCreated={load} />
        </CardContent>
      </Card>

      {items.length > 0 && modifierGroups.length > 0 && (
        <LinkModifierGroupForm items={items} groups={modifierGroups} onCreated={load} />
      )}
    </div>
  );
}

function AddCategoryForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/menu/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not create category.');
        return;
      }
      setName('');
      onCreated();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <div className="flex-1 space-y-1">
        <Label htmlFor="catName" className="text-xs">
          New category
        </Label>
        <Input id="catName" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Mains, Drinks, ..." />
      </div>
      <Button type="submit" size="sm" disabled={loading}>
        Add
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

function AddItemForm({ categories, onCreated }: { categories: Category[]; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/menu/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, price, categoryId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not create item.');
        return;
      }
      setName('');
      setPrice('');
      onCreated();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2 border-t pt-3">
      <div className="flex-1 space-y-1">
        <Label htmlFor="itemName" className="text-xs">
          New item name
        </Label>
        <Input id="itemName" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="itemPrice" className="text-xs">
          Price (₱)
        </Label>
        <Input id="itemPrice" required className="w-28" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="itemCategory" className="text-xs">
          Category
        </Label>
        <select
          id="itemCategory"
          required
          className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Select…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm" disabled={loading || categories.length === 0}>
        Add item
      </Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </form>
  );
}

function AddModifierGroupForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [selectionType, setSelectionType] = useState('SINGLE');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/menu/modifier-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, selectionType, maxSelect: selectionType === 'SINGLE' ? 1 : 5 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not create modifier group.');
        return;
      }
      setName('');
      onCreated();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2 border-t pt-3">
      <div className="flex-1 space-y-1">
        <Label htmlFor="groupName" className="text-xs">
          New modifier group
        </Label>
        <Input id="groupName" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Size, Add-ons, ..." />
      </div>
      <div className="space-y-1">
        <Label htmlFor="selectionType" className="text-xs">
          Selection
        </Label>
        <select
          id="selectionType"
          className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          value={selectionType}
          onChange={(e) => setSelectionType(e.target.value)}
        >
          <option value="SINGLE">Choose one</option>
          <option value="MULTIPLE">Choose any</option>
        </select>
      </div>
      <Button type="submit" size="sm" disabled={loading}>
        Add group
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

function AddModifierForm({ groupId, onCreated }: { groupId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [priceDelta, setPriceDelta] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/menu/modifier-groups/${groupId}/modifiers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, priceDelta }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not add modifier.');
        return;
      }
      setName('');
      setPriceDelta('0');
      onCreated();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 flex flex-wrap items-end gap-2">
      <Input
        placeholder="e.g. Large"
        required
        className="h-8 w-32 text-xs"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        placeholder="+₱ price"
        className="h-8 w-24 text-xs"
        value={priceDelta}
        onChange={(e) => setPriceDelta(e.target.value)}
      />
      <Button type="submit" size="sm" variant="outline" disabled={loading}>
        Add
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

function LinkModifierGroupForm({
  items,
  groups,
  onCreated,
}: {
  items: MenuItemRow[];
  groups: ModifierGroup[];
  onCreated: () => void;
}) {
  const [itemId, setItemId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/menu/items/${itemId}/modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modifierGroupId: groupId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not link modifier group.');
        return;
      }
      onCreated();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Link a modifier group to an item</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
          <select
            required
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
          >
            <option value="">Item…</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <select
            required
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
          >
            <option value="">Modifier group…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" disabled={loading}>
            Link
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
