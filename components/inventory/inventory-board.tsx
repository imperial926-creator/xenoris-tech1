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
interface Unit {
  id: string;
  name: string;
  abbreviation: string;
  baseUnitId: string | null;
  conversionFactor: string;
}
interface Ingredient {
  id: string;
  name: string;
  stockUnitId: string;
  stockUnit: Unit;
  costPerUnit: string;
  active: boolean;
}
interface InventoryItem {
  id: string;
  ingredientId: string;
  ingredient: Ingredient;
  quantityOnHand: string;
  reorderPoint: string | null;
  criticalPoint: string | null;
  stockLevel: 'OK' | 'LOW' | 'CRITICAL';
}
interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
}
interface PurchaseOrderItem {
  id: string;
  ingredientId: string;
  ingredient: Ingredient;
  unitId: string;
  unit: Unit;
  quantityOrdered: string;
  quantityReceived: string;
  unitCost: string;
  lineTotal: string;
}
interface PurchaseOrder {
  id: string;
  status: string;
  total: string;
  supplierId: string;
  supplier: Supplier;
  items: PurchaseOrderItem[];
  notes: string | null;
}
interface StockCountItem {
  id: string;
  inventoryItemId: string;
  inventoryItem: InventoryItem;
  expectedQuantity: string;
  countedQuantity: string | null;
}
interface StockCount {
  id: string;
  status: string;
  createdAt: string;
  items: StockCountItem[];
}
interface MenuItemOption {
  id: string;
  name: string;
}
interface RecipeItem {
  ingredientId: string;
  ingredient: Ingredient;
  unitId: string;
  unit: Unit;
  quantity: string;
}
interface Recipe {
  id: string;
  menuItemId: string;
  yieldQuantity: string;
  notes: string | null;
  items: RecipeItem[];
}

type SectionKey = 'stock' | 'catalog' | 'purchasing' | 'counts';
const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'stock', label: 'Stock' },
  { key: 'catalog', label: 'Catalog' },
  { key: 'purchasing', label: 'Purchasing' },
  { key: 'counts', label: 'Stock Counts' },
];

const LEVEL_BADGE: Record<string, string> = {
  OK: 'bg-secondary text-secondary-foreground',
  LOW: 'bg-amber-100 text-amber-900',
  CRITICAL: 'bg-destructive/15 text-destructive',
};

export function InventoryBoard({ branches }: { branches: Branch[] }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [section, setSection] = useState<SectionKey>('stock');
  const [error, setError] = useState<string | null>(null);

  const [units, setUnits] = useState<Unit[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [stockCounts, setStockCounts] = useState<StockCount[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemOption[]>([]);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setError(null);
    try {
      const [unitsRes, ingredientsRes, itemsRes, suppliersRes, posRes, countsRes, menuRes] = await Promise.all([
        fetch('/api/units'),
        fetch('/api/ingredients'),
        fetch(`/api/branches/${id}/inventory/items`),
        fetch('/api/suppliers'),
        fetch(`/api/branches/${id}/inventory/purchase-orders`),
        fetch(`/api/branches/${id}/inventory/stock-counts`),
        fetch('/api/menu/items'),
      ]);
      const [unitsData, ingredientsData, itemsData, suppliersData, posData, countsData, menuData] = await Promise.all([
        unitsRes.json(), ingredientsRes.json(), itemsRes.json(), suppliersRes.json(), posRes.json(), countsRes.json(), menuRes.json(),
      ]);
      if (!unitsRes.ok) throw new Error(unitsData.error ?? 'Failed to load units.');
      if (!ingredientsRes.ok) throw new Error(ingredientsData.error ?? 'Failed to load ingredients.');
      if (!itemsRes.ok) throw new Error(itemsData.error ?? 'Failed to load stock.');
      if (!suppliersRes.ok) throw new Error(suppliersData.error ?? 'Failed to load suppliers.');
      if (!posRes.ok) throw new Error(posData.error ?? 'Failed to load purchase orders.');
      if (!countsRes.ok) throw new Error(countsData.error ?? 'Failed to load stock counts.');
      if (!menuRes.ok) throw new Error(menuData.error ?? 'Failed to load menu items.');
      setUnits(unitsData.units);
      setIngredients(ingredientsData.ingredients);
      setItems(itemsData.items);
      setSuppliers(suppliersData.suppliers);
      setPurchaseOrders(posData.purchaseOrders);
      setStockCounts(countsData.stockCounts);
      setMenuItems(menuData.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }, []);

  useEffect(() => {
    load(branchId);
  }, [branchId, load]);

  if (branches.length === 0) {
    return <p className="text-sm text-muted-foreground">No branches yet — add one under Settings first.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="branch-select" className="text-sm">Branch</Label>
        <select
          id="branch-select"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <div className="flex gap-2">
          {SECTIONS.map((s) => (
            <Button key={s.key} type="button" variant={section === s.key ? 'default' : 'outline'} size="sm" onClick={() => setSection(s.key)}>
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {section === 'stock' && (
        <StockSection branchId={branchId} items={items} ingredients={ingredients} branches={branches} onChange={() => load(branchId)} />
      )}
      {section === 'catalog' && (
        <CatalogSection units={units} ingredients={ingredients} menuItems={menuItems} onChange={() => load(branchId)} />
      )}
      {section === 'purchasing' && (
        <PurchasingSection branchId={branchId} suppliers={suppliers} ingredients={ingredients} units={units} purchaseOrders={purchaseOrders} onChange={() => load(branchId)} />
      )}
      {section === 'counts' && (
        <CountsSection branchId={branchId} stockCounts={stockCounts} onChange={() => load(branchId)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

function StockSection({
  branchId, items, ingredients, branches, onChange,
}: {
  branchId: string; items: InventoryItem[]; ingredients: Ingredient[]; branches: Branch[]; onChange: () => void;
}) {
  const [newItem, setNewItem] = useState({ ingredientId: '', initialQuantity: '0', reorderPoint: '', criticalPoint: '' });
  const [adjustments, setAdjustments] = useState<Record<string, { type: string; quantityDelta: string; reason: string }>>({});
  const [wastes, setWastes] = useState<Record<string, { quantity: string; reason: string }>>({});
  const [transfer, setTransfer] = useState({ ingredientId: '', toBranchId: '', quantity: '', note: '' });
  const [busyError, setBusyError] = useState<string | null>(null);

  async function createItem() {
    setBusyError(null);
    const res = await fetch(`/api/branches/${branchId}/inventory/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredientId: newItem.ingredientId,
        initialQuantity: newItem.initialQuantity || '0',
        reorderPoint: newItem.reorderPoint || undefined,
        criticalPoint: newItem.criticalPoint || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to add stock line.'); return; }
    setNewItem({ ingredientId: '', initialQuantity: '0', reorderPoint: '', criticalPoint: '' });
    onChange();
  }

  async function submitAdjustment(itemId: string) {
    const form = adjustments[itemId];
    if (!form) return;
    setBusyError(null);
    const res = await fetch(`/api/branches/${branchId}/inventory/items/${itemId}/adjustments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to record adjustment.'); return; }
    setAdjustments((prev) => ({ ...prev, [itemId]: { type: 'ADJUSTMENT', quantityDelta: '', reason: '' } }));
    onChange();
  }

  async function submitWaste(itemId: string) {
    const form = wastes[itemId];
    if (!form) return;
    setBusyError(null);
    const res = await fetch(`/api/branches/${branchId}/inventory/items/${itemId}/waste`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to record waste.'); return; }
    setWastes((prev) => ({ ...prev, [itemId]: { quantity: '', reason: '' } }));
    onChange();
  }

  async function submitTransfer() {
    setBusyError(null);
    const res = await fetch(`/api/branches/${branchId}/inventory/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transfer),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to transfer stock.'); return; }
    setTransfer({ ingredientId: '', toBranchId: '', quantity: '', note: '' });
    onChange();
  }

  const stockedIngredientIds = new Set(items.map((i) => i.ingredientId));
  const availableToStock = ingredients.filter((i) => !stockedIngredientIds.has(i.id));

  return (
    <div className="space-y-4">
      {busyError && <p className="text-sm text-destructive">{busyError}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Current stock</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 && <p className="text-sm text-muted-foreground">No stock lines at this branch yet.</p>}
          {items.map((item) => (
            <div key={item.id} className="rounded-md border p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{item.ingredient.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.quantityOnHand} {item.ingredient.stockUnit.abbreviation} on hand
                    {item.reorderPoint ? ` · reorder at ${item.reorderPoint}` : ''}
                    {item.criticalPoint ? ` · critical at ${item.criticalPoint}` : ''}
                  </p>
                </div>
                <span className={`rounded px-2 py-1 text-xs font-medium ${LEVEL_BADGE[item.stockLevel]}`}>{item.stockLevel}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <Label className="text-xs">Adjust (+/-)</Label>
                    <Input
                      className="h-8 w-24"
                      placeholder="e.g. -5"
                      value={adjustments[item.id]?.quantityDelta ?? ''}
                      onChange={(e) => setAdjustments((prev) => ({ ...prev, [item.id]: { type: prev[item.id]?.type ?? 'ADJUSTMENT', reason: prev[item.id]?.reason ?? '', quantityDelta: e.target.value } }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Type</Label>
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      value={adjustments[item.id]?.type ?? 'ADJUSTMENT'}
                      onChange={(e) => setAdjustments((prev) => ({ ...prev, [item.id]: { quantityDelta: prev[item.id]?.quantityDelta ?? '', reason: prev[item.id]?.reason ?? '', type: e.target.value } }))}
                    >
                      <option value="ADJUSTMENT">Adjustment</option>
                      <option value="RETURN">Return</option>
                    </select>
                  </div>
                  <Input
                    className="h-8 flex-1"
                    placeholder="Reason"
                    value={adjustments[item.id]?.reason ?? ''}
                    onChange={(e) => setAdjustments((prev) => ({ ...prev, [item.id]: { type: prev[item.id]?.type ?? 'ADJUSTMENT', quantityDelta: prev[item.id]?.quantityDelta ?? '', reason: e.target.value } }))}
                  />
                  <Button size="sm" variant="outline" onClick={() => submitAdjustment(item.id)}>Apply</Button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <Label className="text-xs">Waste qty</Label>
                    <Input
                      className="h-8 w-24"
                      value={wastes[item.id]?.quantity ?? ''}
                      onChange={(e) => setWastes((prev) => ({ ...prev, [item.id]: { reason: prev[item.id]?.reason ?? '', quantity: e.target.value } }))}
                    />
                  </div>
                  <Input
                    className="h-8 flex-1"
                    placeholder="Reason (spoilage, drop, etc.)"
                    value={wastes[item.id]?.reason ?? ''}
                    onChange={(e) => setWastes((prev) => ({ ...prev, [item.id]: { quantity: prev[item.id]?.quantity ?? '', reason: e.target.value } }))}
                  />
                  <Button size="sm" variant="outline" onClick={() => submitWaste(item.id)}>Log waste</Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Add a stock line</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">Ingredient</Label>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={newItem.ingredientId}
              onChange={(e) => setNewItem((p) => ({ ...p, ingredientId: e.target.value }))}
            >
              <option value="">Select…</option>
              {availableToStock.map((i) => (
                <option key={i.id} value={i.id}>{i.name} ({i.stockUnit.abbreviation})</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Initial qty</Label>
            <Input className="h-9 w-24" value={newItem.initialQuantity} onChange={(e) => setNewItem((p) => ({ ...p, initialQuantity: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Reorder at</Label>
            <Input className="h-9 w-24" value={newItem.reorderPoint} onChange={(e) => setNewItem((p) => ({ ...p, reorderPoint: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Critical at</Label>
            <Input className="h-9 w-24" value={newItem.criticalPoint} onChange={(e) => setNewItem((p) => ({ ...p, criticalPoint: e.target.value }))} />
          </div>
          <Button size="sm" disabled={!newItem.ingredientId} onClick={createItem}>Add</Button>
        </CardContent>
      </Card>

      {branches.length > 1 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Transfer stock to another branch</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Ingredient</Label>
              <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={transfer.ingredientId} onChange={(e) => setTransfer((p) => ({ ...p, ingredientId: e.target.value }))}>
                <option value="">Select…</option>
                {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">To branch</Label>
              <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={transfer.toBranchId} onChange={(e) => setTransfer((p) => ({ ...p, toBranchId: e.target.value }))}>
                <option value="">Select…</option>
                {branches.filter((b) => b.id !== branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Quantity</Label>
              <Input className="h-9 w-24" value={transfer.quantity} onChange={(e) => setTransfer((p) => ({ ...p, quantity: e.target.value }))} />
            </div>
            <Input className="h-9 flex-1" placeholder="Note (optional)" value={transfer.note} onChange={(e) => setTransfer((p) => ({ ...p, note: e.target.value }))} />
            <Button size="sm" disabled={!transfer.ingredientId || !transfer.toBranchId || !transfer.quantity} onClick={submitTransfer}>Transfer</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalog: units, ingredients, recipes
// ---------------------------------------------------------------------------

function CatalogSection({
  units, ingredients, menuItems, onChange,
}: {
  units: Unit[]; ingredients: Ingredient[]; menuItems: MenuItemOption[]; onChange: () => void;
}) {
  const [newUnit, setNewUnit] = useState({ name: '', abbreviation: '', baseUnitId: '', conversionFactor: '1' });
  const [newIngredient, setNewIngredient] = useState({ name: '', stockUnitId: '', costPerUnit: '0' });
  const [recipeMenuItemId, setRecipeMenuItemId] = useState('');
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [recipeYield, setRecipeYield] = useState('1');
  const [recipeLines, setRecipeLines] = useState<{ ingredientId: string; quantity: string; unitId: string }[]>([]);
  const [busyError, setBusyError] = useState<string | null>(null);

  async function createUnit() {
    setBusyError(null);
    const res = await fetch('/api/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newUnit.name, abbreviation: newUnit.abbreviation,
        baseUnitId: newUnit.baseUnitId || undefined,
        conversionFactor: newUnit.baseUnitId ? newUnit.conversionFactor : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to create unit.'); return; }
    setNewUnit({ name: '', abbreviation: '', baseUnitId: '', conversionFactor: '1' });
    onChange();
  }

  async function createIngredient() {
    setBusyError(null);
    const res = await fetch('/api/ingredients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newIngredient),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to create ingredient.'); return; }
    setNewIngredient({ name: '', stockUnitId: '', costPerUnit: '0' });
    onChange();
  }

  async function loadRecipe(menuItemId: string) {
    setRecipeMenuItemId(menuItemId);
    setRecipe(null);
    setRecipeLines([]);
    setRecipeYield('1');
    if (!menuItemId) return;
    const res = await fetch(`/api/recipes/by-menu-item/${menuItemId}`);
    const data = await res.json();
    if (res.ok && data.recipe) {
      setRecipe(data.recipe);
      setRecipeYield(data.recipe.yieldQuantity);
      setRecipeLines(data.recipe.items.map((i: RecipeItem) => ({ ingredientId: i.ingredientId, quantity: i.quantity, unitId: i.unitId })));
    }
  }

  function addRecipeLine() {
    setRecipeLines((lines) => [...lines, { ingredientId: '', quantity: '', unitId: '' }]);
  }

  async function saveRecipe() {
    setBusyError(null);
    const items = recipeLines.filter((l) => l.ingredientId && l.quantity && l.unitId);
    const body = { yieldQuantity: recipeYield, items };
    const res = recipe
      ? await fetch(`/api/recipes/${recipe.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch('/api/recipes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, menuItemId: recipeMenuItemId }) });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to save recipe.'); return; }
    loadRecipe(recipeMenuItemId);
    onChange();
  }

  return (
    <div className="space-y-4">
      {busyError && <p className="text-sm text-destructive">{busyError}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Units</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            {units.map((u) => (
              <span key={u.id} className="rounded-md border px-2 py-1">
                {u.name} ({u.abbreviation}){u.baseUnitId ? ` = ${u.conversionFactor}× base` : ' — base unit'}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div><Label className="text-xs">Name</Label><Input className="h-9 w-32" value={newUnit.name} onChange={(e) => setNewUnit((p) => ({ ...p, name: e.target.value }))} /></div>
            <div><Label className="text-xs">Abbrev.</Label><Input className="h-9 w-20" value={newUnit.abbreviation} onChange={(e) => setNewUnit((p) => ({ ...p, abbreviation: e.target.value }))} /></div>
            <div>
              <Label className="text-xs">Base unit (optional)</Label>
              <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={newUnit.baseUnitId} onChange={(e) => setNewUnit((p) => ({ ...p, baseUnitId: e.target.value }))}>
                <option value="">— this is a base unit —</option>
                {units.filter((u) => !u.baseUnitId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            {newUnit.baseUnitId && (
              <div><Label className="text-xs">× per 1 base</Label><Input className="h-9 w-24" value={newUnit.conversionFactor} onChange={(e) => setNewUnit((p) => ({ ...p, conversionFactor: e.target.value }))} /></div>
            )}
            <Button size="sm" disabled={!newUnit.name || !newUnit.abbreviation} onClick={createUnit}>Add unit</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Ingredients</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1 text-sm">
            {ingredients.map((i) => (
              <p key={i.id}>{i.name} — tracked in {i.stockUnit.abbreviation}, cost {i.costPerUnit}/{i.stockUnit.abbreviation}</p>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div><Label className="text-xs">Name</Label><Input className="h-9 w-40" value={newIngredient.name} onChange={(e) => setNewIngredient((p) => ({ ...p, name: e.target.value }))} /></div>
            <div>
              <Label className="text-xs">Stock unit</Label>
              <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={newIngredient.stockUnitId} onChange={(e) => setNewIngredient((p) => ({ ...p, stockUnitId: e.target.value }))}>
                <option value="">Select…</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
              </select>
            </div>
            <div><Label className="text-xs">Cost/unit</Label><Input className="h-9 w-24" value={newIngredient.costPerUnit} onChange={(e) => setNewIngredient((p) => ({ ...p, costPerUnit: e.target.value }))} /></div>
            <Button size="sm" disabled={!newIngredient.name || !newIngredient.stockUnitId} onClick={createIngredient}>Add ingredient</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recipes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Menu item</Label>
            <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={recipeMenuItemId} onChange={(e) => loadRecipe(e.target.value)}>
              <option value="">Select a menu item…</option>
              {menuItems.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {recipeMenuItemId && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Yields (servings)</Label>
                <Input className="h-9 w-20" value={recipeYield} onChange={(e) => setRecipeYield(e.target.value)} />
              </div>
              {recipeLines.map((line, idx) => (
                <div key={idx} className="flex flex-wrap items-end gap-2">
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={line.ingredientId}
                    onChange={(e) => setRecipeLines((lines) => lines.map((l, i) => (i === idx ? { ...l, ingredientId: e.target.value } : l)))}
                  >
                    <option value="">Ingredient…</option>
                    {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                  <Input
                    className="h-9 w-24"
                    placeholder="Quantity"
                    value={line.quantity}
                    onChange={(e) => setRecipeLines((lines) => lines.map((l, i) => (i === idx ? { ...l, quantity: e.target.value } : l)))}
                  />
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={line.unitId}
                    onChange={(e) => setRecipeLines((lines) => lines.map((l, i) => (i === idx ? { ...l, unitId: e.target.value } : l)))}
                  >
                    <option value="">Unit…</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.abbreviation}</option>)}
                  </select>
                  <Button size="sm" variant="ghost" onClick={() => setRecipeLines((lines) => lines.filter((_, i) => i !== idx))}>Remove</Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={addRecipeLine}>+ Add ingredient line</Button>
                <Button size="sm" disabled={recipeLines.length === 0} onClick={saveRecipe}>{recipe ? 'Save recipe' : 'Create recipe'}</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Purchasing: suppliers + purchase orders
// ---------------------------------------------------------------------------

function PurchasingSection({
  branchId, suppliers, ingredients, units, purchaseOrders, onChange,
}: {
  branchId: string; suppliers: Supplier[]; ingredients: Ingredient[]; units: Unit[]; purchaseOrders: PurchaseOrder[]; onChange: () => void;
}) {
  const [newSupplier, setNewSupplier] = useState({ name: '', contactName: '', email: '', phone: '' });
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poLines, setPoLines] = useState<{ ingredientId: string; unitId: string; quantityOrdered: string; unitCost: string }[]>([]);
  const [receiveForms, setReceiveForms] = useState<Record<string, Record<string, string>>>({});
  const [cancelReasons, setCancelReasons] = useState<Record<string, string>>({});
  const [busyError, setBusyError] = useState<string | null>(null);

  async function createSupplier() {
    setBusyError(null);
    const res = await fetch('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSupplier),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to create supplier.'); return; }
    setNewSupplier({ name: '', contactName: '', email: '', phone: '' });
    onChange();
  }

  function addPoLine() {
    setPoLines((lines) => [...lines, { ingredientId: '', unitId: '', quantityOrdered: '', unitCost: '' }]);
  }

  async function createPurchaseOrder() {
    setBusyError(null);
    const items = poLines.filter((l) => l.ingredientId && l.unitId && l.quantityOrdered && l.unitCost);
    const res = await fetch(`/api/branches/${branchId}/inventory/purchase-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supplierId: poSupplierId, items }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to create purchase order.'); return; }
    setPoSupplierId(''); setPoLines([]);
    onChange();
  }

  async function submitPo(poId: string) {
    const res = await fetch(`/api/branches/${branchId}/inventory/purchase-orders/${poId}/submit`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to submit purchase order.'); return; }
    onChange();
  }

  async function receivePo(po: PurchaseOrder) {
    const form = receiveForms[po.id] ?? {};
    const items = Object.entries(form).filter(([, qty]) => qty).map(([purchaseOrderItemId, quantityReceived]) => ({ purchaseOrderItemId, quantityReceived }));
    if (items.length === 0) return;
    const res = await fetch(`/api/branches/${branchId}/inventory/purchase-orders/${po.id}/receive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to receive purchase order.'); return; }
    setReceiveForms((prev) => ({ ...prev, [po.id]: {} }));
    onChange();
  }

  async function cancelPo(poId: string) {
    const reason = cancelReasons[poId];
    if (!reason) return;
    const res = await fetch(`/api/branches/${branchId}/inventory/purchase-orders/${poId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancellationReason: reason }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to cancel purchase order.'); return; }
    setCancelReasons((prev) => ({ ...prev, [poId]: '' }));
    onChange();
  }

  return (
    <div className="space-y-4">
      {busyError && <p className="text-sm text-destructive">{busyError}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Suppliers</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            {suppliers.map((s) => <span key={s.id} className="rounded-md border px-2 py-1">{s.name}{s.contactName ? ` — ${s.contactName}` : ''}</span>)}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div><Label className="text-xs">Name</Label><Input className="h-9 w-40" value={newSupplier.name} onChange={(e) => setNewSupplier((p) => ({ ...p, name: e.target.value }))} /></div>
            <div><Label className="text-xs">Contact</Label><Input className="h-9 w-32" value={newSupplier.contactName} onChange={(e) => setNewSupplier((p) => ({ ...p, contactName: e.target.value }))} /></div>
            <div><Label className="text-xs">Email</Label><Input className="h-9 w-40" value={newSupplier.email} onChange={(e) => setNewSupplier((p) => ({ ...p, email: e.target.value }))} /></div>
            <div><Label className="text-xs">Phone</Label><Input className="h-9 w-32" value={newSupplier.phone} onChange={(e) => setNewSupplier((p) => ({ ...p, phone: e.target.value }))} /></div>
            <Button size="sm" disabled={!newSupplier.name} onClick={createSupplier}>Add supplier</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">New purchase order</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Supplier</Label>
            <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={poSupplierId} onChange={(e) => setPoSupplierId(e.target.value)}>
              <option value="">Select…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {poLines.map((line, idx) => (
            <div key={idx} className="flex flex-wrap items-end gap-2">
              <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={line.ingredientId} onChange={(e) => setPoLines((lines) => lines.map((l, i) => (i === idx ? { ...l, ingredientId: e.target.value } : l)))}>
                <option value="">Ingredient…</option>
                {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={line.unitId} onChange={(e) => setPoLines((lines) => lines.map((l, i) => (i === idx ? { ...l, unitId: e.target.value } : l)))}>
                <option value="">Unit…</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.abbreviation}</option>)}
              </select>
              <Input className="h-9 w-24" placeholder="Qty" value={line.quantityOrdered} onChange={(e) => setPoLines((lines) => lines.map((l, i) => (i === idx ? { ...l, quantityOrdered: e.target.value } : l)))} />
              <Input className="h-9 w-24" placeholder="Unit cost" value={line.unitCost} onChange={(e) => setPoLines((lines) => lines.map((l, i) => (i === idx ? { ...l, unitCost: e.target.value } : l)))} />
              <Button size="sm" variant="ghost" onClick={() => setPoLines((lines) => lines.filter((_, i) => i !== idx))}>Remove</Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addPoLine}>+ Add line</Button>
            <Button size="sm" disabled={!poSupplierId || poLines.length === 0} onClick={createPurchaseOrder}>Create draft PO</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Purchase orders</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {purchaseOrders.length === 0 && <p className="text-sm text-muted-foreground">No purchase orders yet.</p>}
          {purchaseOrders.map((po) => (
            <div key={po.id} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{po.supplier.name} — {po.status} — ₱{po.total}</p>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {po.items.map((item) => (
                  <p key={item.id}>{item.ingredient.name}: {item.quantityReceived}/{item.quantityOrdered} {item.unit.abbreviation} received</p>
                ))}
              </div>
              {po.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => submitPo(po.id)}>Submit</Button>}
              {(po.status === 'SUBMITTED' || po.status === 'PARTIALLY_RECEIVED') && (
                <div className="space-y-2">
                  {po.items.filter((item) => item.quantityReceived !== item.quantityOrdered).map((item) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <span className="text-xs">{item.ingredient.name}</span>
                      <Input
                        className="h-8 w-24"
                        placeholder="Qty received"
                        value={receiveForms[po.id]?.[item.id] ?? ''}
                        onChange={(e) => setReceiveForms((prev) => ({ ...prev, [po.id]: { ...prev[po.id], [item.id]: e.target.value } }))}
                      />
                    </div>
                  ))}
                  <Button size="sm" onClick={() => receivePo(po)}>Receive</Button>
                </div>
              )}
              {(po.status === 'DRAFT' || po.status === 'SUBMITTED') && (
                <div className="flex items-center gap-2">
                  <Input className="h-8 flex-1" placeholder="Cancellation reason" value={cancelReasons[po.id] ?? ''} onChange={(e) => setCancelReasons((prev) => ({ ...prev, [po.id]: e.target.value }))} />
                  <Button size="sm" variant="outline" onClick={() => cancelPo(po.id)}>Cancel</Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock counts
// ---------------------------------------------------------------------------

function CountsSection({ branchId, stockCounts, onChange }: { branchId: string; stockCounts: StockCount[]; onChange: () => void }) {
  const [counted, setCounted] = useState<Record<string, Record<string, string>>>({});
  const [busyError, setBusyError] = useState<string | null>(null);

  async function startCount() {
    setBusyError(null);
    const res = await fetch(`/api/branches/${branchId}/inventory/stock-counts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to start a stock count.'); return; }
    onChange();
  }

  async function saveCounts(count: StockCount) {
    const form = counted[count.id] ?? {};
    const items = Object.entries(form).filter(([, qty]) => qty).map(([inventoryItemId, countedQuantity]) => ({ inventoryItemId, countedQuantity }));
    if (items.length === 0) return;
    const res = await fetch(`/api/branches/${branchId}/inventory/stock-counts/${count.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to save counts.'); return; }
    setCounted((prev) => ({ ...prev, [count.id]: {} }));
    onChange();
  }

  async function cancelCount(countId: string) {
    const res = await fetch(`/api/branches/${branchId}/inventory/stock-counts/${countId}/cancel`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { setBusyError(data.error ?? 'Failed to cancel count.'); return; }
    onChange();
  }

  return (
    <div className="space-y-4">
      {busyError && <p className="text-sm text-destructive">{busyError}</p>}
      <Button size="sm" onClick={startCount}>Start a new stock count</Button>
      {stockCounts.map((count) => (
        <Card key={count.id}>
          <CardHeader><CardTitle className="text-base">Count started {new Date(count.createdAt).toLocaleString()} — {count.status}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {count.items.map((line) => (
              <div key={line.id} className="flex items-center gap-2">
                <span className="w-48 text-sm">{line.inventoryItem.ingredient.name}</span>
                <span className="text-xs text-muted-foreground">expected {line.expectedQuantity}</span>
                {count.status === 'OPEN' ? (
                  <Input
                    className="h-8 w-24"
                    placeholder={line.countedQuantity ?? 'Counted qty'}
                    value={counted[count.id]?.[line.inventoryItemId] ?? ''}
                    onChange={(e) => setCounted((prev) => ({ ...prev, [count.id]: { ...prev[count.id], [line.inventoryItemId]: e.target.value } }))}
                  />
                ) : (
                  <span className="text-xs">counted {line.countedQuantity ?? '—'}</span>
                )}
              </div>
            ))}
            {count.status === 'OPEN' && (
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={() => saveCounts(count)}>Save counts</Button>
                <Button size="sm" variant="outline" onClick={() => cancelCount(count.id)}>Cancel count</Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
