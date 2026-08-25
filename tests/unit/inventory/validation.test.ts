import { describe, it, expect } from 'vitest';
import {
  createUnitSchema,
  createIngredientSchema,
  createRecipeSchema,
  createInventoryItemSchema,
  updateInventoryItemSchema,
  recordAdjustmentSchema,
  recordWasteSchema,
  transferStockSchema,
  createSupplierSchema,
  createPurchaseOrderSchema,
  receivePurchaseOrderSchema,
  completeStockCountSchema,
  listInventoryItemsQuerySchema,
} from '@/lib/validation/inventory';

describe('createUnitSchema', () => {
  it('accepts a base unit with no baseUnitId, defaulting conversionFactor to 1', () => {
    const result = createUnitSchema.parse({ name: 'Kilogram', abbreviation: 'kg' });
    expect(result.conversionFactor).toBe('1');
    expect(result.baseUnitId).toBeUndefined();
  });

  it('accepts a derived unit with an explicit conversionFactor', () => {
    const result = createUnitSchema.parse({ name: 'Gram', abbreviation: 'g', baseUnitId: 'unit_kg', conversionFactor: 1000 });
    expect(result.conversionFactor).toBe('1000');
  });

  it('rejects a zero or negative conversionFactor', () => {
    expect(createUnitSchema.safeParse({ name: 'Gram', abbreviation: 'g', conversionFactor: 0 }).success).toBe(false);
    expect(createUnitSchema.safeParse({ name: 'Gram', abbreviation: 'g', conversionFactor: -5 }).success).toBe(false);
  });

  it('rejects a missing abbreviation', () => {
    expect(createUnitSchema.safeParse({ name: 'Gram' }).success).toBe(false);
  });
});

describe('createIngredientSchema', () => {
  it('defaults costPerUnit to 0', () => {
    const result = createIngredientSchema.parse({ name: 'Chicken', stockUnitId: 'unit_kg' });
    expect(result.costPerUnit).toBe('0');
  });

  it('accepts up to 4 decimal places on cost', () => {
    expect(createIngredientSchema.safeParse({ name: 'Chicken', stockUnitId: 'unit_kg', costPerUnit: '180.1234' }).success).toBe(true);
  });

  it('rejects a negative cost', () => {
    expect(createIngredientSchema.safeParse({ name: 'Chicken', stockUnitId: 'unit_kg', costPerUnit: '-1.00' }).success).toBe(false);
  });
});

describe('createRecipeSchema', () => {
  it('requires at least one ingredient line', () => {
    expect(createRecipeSchema.safeParse({ menuItemId: 'item1', items: [] }).success).toBe(false);
  });

  it('defaults yieldQuantity to 1', () => {
    const result = createRecipeSchema.parse({
      menuItemId: 'item1',
      items: [{ ingredientId: 'ing1', quantity: '200', unitId: 'unit_g' }],
    });
    expect(result.yieldQuantity).toBe('1');
  });

  it('rejects a zero quantity on a recipe line', () => {
    const result = createRecipeSchema.safeParse({
      menuItemId: 'item1',
      items: [{ ingredientId: 'ing1', quantity: '0', unitId: 'unit_g' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('createInventoryItemSchema', () => {
  it('defaults initialQuantity to 0 and allows omitted thresholds', () => {
    const result = createInventoryItemSchema.parse({ ingredientId: 'ing1' });
    expect(result.initialQuantity).toBe('0');
    expect(result.reorderPoint).toBeUndefined();
  });

  it('rejects a negative initialQuantity', () => {
    expect(createInventoryItemSchema.safeParse({ ingredientId: 'ing1', initialQuantity: '-5' }).success).toBe(false);
  });
});

describe('updateInventoryItemSchema', () => {
  it('accepts explicit null to clear a threshold', () => {
    const result = updateInventoryItemSchema.parse({ reorderPoint: null });
    expect(result.reorderPoint).toBeNull();
  });

  it('accepts omitting a threshold entirely (leave unchanged)', () => {
    const result = updateInventoryItemSchema.parse({});
    expect(result.reorderPoint).toBeUndefined();
  });
});

describe('recordAdjustmentSchema', () => {
  it('accepts a positive or negative signed delta', () => {
    expect(recordAdjustmentSchema.safeParse({ type: 'ADJUSTMENT', quantityDelta: '5', reason: 'Recount' }).success).toBe(true);
    expect(recordAdjustmentSchema.safeParse({ type: 'ADJUSTMENT', quantityDelta: '-5', reason: 'Recount' }).success).toBe(true);
  });

  it('rejects a zero delta', () => {
    expect(recordAdjustmentSchema.safeParse({ type: 'ADJUSTMENT', quantityDelta: '0', reason: 'No-op' }).success).toBe(false);
  });

  it('rejects an undocumented adjustment type', () => {
    expect(recordAdjustmentSchema.safeParse({ type: 'WASTE', quantityDelta: '-1', reason: 'x' }).success).toBe(false);
  });

  it('rejects a missing reason', () => {
    expect(recordAdjustmentSchema.safeParse({ type: 'ADJUSTMENT', quantityDelta: '1' }).success).toBe(false);
  });
});

describe('recordWasteSchema', () => {
  it('rejects a negative or zero quantity', () => {
    expect(recordWasteSchema.safeParse({ quantity: '0', reason: 'Spilled' }).success).toBe(false);
    expect(recordWasteSchema.safeParse({ quantity: '-1', reason: 'Spilled' }).success).toBe(false);
  });
});

describe('transferStockSchema', () => {
  it('accepts a minimal transfer', () => {
    expect(transferStockSchema.safeParse({ toBranchId: 'branch2', ingredientId: 'ing1', quantity: '5' }).success).toBe(true);
  });
});

describe('createSupplierSchema', () => {
  it('rejects a malformed email', () => {
    expect(createSupplierSchema.safeParse({ name: 'Acme', email: 'not-an-email' }).success).toBe(false);
  });

  it('accepts a minimal supplier with just a name', () => {
    expect(createSupplierSchema.safeParse({ name: 'Acme Produce' }).success).toBe(true);
  });
});

describe('createPurchaseOrderSchema', () => {
  it('requires at least one line item', () => {
    expect(createPurchaseOrderSchema.safeParse({ supplierId: 'sup1', items: [] }).success).toBe(false);
  });

  it('accepts a valid single-line purchase order', () => {
    const result = createPurchaseOrderSchema.safeParse({
      supplierId: 'sup1',
      items: [{ ingredientId: 'ing1', unitId: 'unit_kg', quantityOrdered: '10', unitCost: '190.00' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('receivePurchaseOrderSchema', () => {
  it('requires at least one line', () => {
    expect(receivePurchaseOrderSchema.safeParse({ items: [] }).success).toBe(false);
  });
});

describe('completeStockCountSchema', () => {
  it('accepts a non-negative counted quantity, including zero', () => {
    const result = completeStockCountSchema.safeParse({ items: [{ inventoryItemId: 'item1', countedQuantity: '0' }] });
    expect(result.success).toBe(true);
  });

  it('rejects a negative counted quantity', () => {
    const result = completeStockCountSchema.safeParse({ items: [{ inventoryItemId: 'item1', countedQuantity: '-1' }] });
    expect(result.success).toBe(false);
  });
});

describe('listInventoryItemsQuerySchema', () => {
  it('transforms the lowStockOnly query string into a boolean', () => {
    expect(listInventoryItemsQuerySchema.parse({ lowStockOnly: 'true' }).lowStockOnly).toBe(true);
    expect(listInventoryItemsQuerySchema.parse({}).lowStockOnly).toBe(false);
  });
});
