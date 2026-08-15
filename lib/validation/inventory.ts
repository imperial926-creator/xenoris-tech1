import { z } from 'zod';

export const INVENTORY_TRANSACTION_TYPES = [
  'PURCHASE',
  'SALE_CONSUMPTION',
  'WASTE',
  'ADJUSTMENT',
  'RETURN',
  'TRANSFER',
  'COUNT_CORRECTION',
] as const;

export const PURCHASE_ORDER_STATUSES = ['DRAFT', 'SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;
export const STOCK_COUNT_STATUSES = ['OPEN', 'COMPLETED', 'CANCELLED'] as const;

// Decimal-as-string in, Decimal out via Prisma — same pattern as every
// other validation file in this codebase. Quantities/costs allow up to 4
// decimal places (grams/milliliters and their per-unit costs routinely
// need more precision than 2dp money), unlike order/invoice totals.
const quantityString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v) && Number(v) > 0, 'Must be a positive quantity with up to 4 decimal places.');

const nonNegativeQuantityString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), 'Must be a non-negative quantity with up to 4 decimal places.');

// Signed — used for manual adjustments, which can move stock in either
// direction.
const signedQuantityString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^-?\d+(\.\d{1,4})?$/.test(v) && Number(v) !== 0, 'Must be a non-zero quantity (positive or negative) with up to 4 decimal places.');

const costString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), 'Must be a non-negative cost with up to 4 decimal places.');

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export const createUnitSchema = z.object({
  name: z.string().trim().min(1).max(60),
  abbreviation: z.string().trim().min(1).max(10),
  // Omitted/undefined -> this is a base unit. Present -> a derived unit
  // expressed as (conversionFactor) of itself equal to 1 of the base unit.
  baseUnitId: z.string().trim().min(1).optional(),
  conversionFactor: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => /^\d+(\.\d{1,6})?$/.test(v) && Number(v) > 0, 'Must be a positive number.')
    .default('1'),
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;

export const updateUnitSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  abbreviation: z.string().trim().min(1).max(10).optional(),
});
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

export const createIngredientSchema = z.object({
  name: z.string().trim().min(1).max(150),
  stockUnitId: z.string().trim().min(1),
  costPerUnit: costString.default('0'),
});
export type CreateIngredientInput = z.infer<typeof createIngredientSchema>;

export const updateIngredientSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  costPerUnit: costString.optional(),
  active: z.boolean().optional(),
});
export type UpdateIngredientInput = z.infer<typeof updateIngredientSchema>;

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export const recipeItemInputSchema = z.object({
  ingredientId: z.string().trim().min(1),
  quantity: quantityString,
  unitId: z.string().trim().min(1),
});
export type RecipeItemInput = z.infer<typeof recipeItemInputSchema>;

export const createRecipeSchema = z.object({
  menuItemId: z.string().trim().min(1),
  yieldQuantity: quantityString.default('1'),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(recipeItemInputSchema).min(1, 'A recipe needs at least one ingredient.'),
});
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;

export const updateRecipeSchema = z.object({
  yieldQuantity: quantityString.optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(recipeItemInputSchema).min(1).optional(),
});
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;

// ---------------------------------------------------------------------------
// Inventory items / adjustments / waste / transfers
// ---------------------------------------------------------------------------

export const createInventoryItemSchema = z.object({
  ingredientId: z.string().trim().min(1),
  initialQuantity: nonNegativeQuantityString.default('0'),
  reorderPoint: nonNegativeQuantityString.optional(),
  criticalPoint: nonNegativeQuantityString.optional(),
});
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;

export const updateInventoryItemSchema = z.object({
  reorderPoint: z.union([nonNegativeQuantityString, z.null()]).optional(),
  criticalPoint: z.union([nonNegativeQuantityString, z.null()]).optional(),
});
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>;

export const recordAdjustmentSchema = z.object({
  // ADJUSTMENT = generic manual correction (either direction). RETURN =
  // stock leaving because it went back to a supplier (typically negative,
  // but not force-signed — a supplier could over-credit and this stays
  // generic).
  type: z.enum(['ADJUSTMENT', 'RETURN']),
  quantityDelta: signedQuantityString,
  reason: z.string().trim().min(1).max(500),
});
export type RecordAdjustmentInput = z.infer<typeof recordAdjustmentSchema>;

export const recordWasteSchema = z.object({
  quantity: quantityString,
  reason: z.string().trim().min(1).max(500),
});
export type RecordWasteInput = z.infer<typeof recordWasteSchema>;

export const transferStockSchema = z.object({
  toBranchId: z.string().trim().min(1),
  ingredientId: z.string().trim().min(1),
  quantity: quantityString,
  note: z.string().trim().max(500).optional(),
});
export type TransferStockInput = z.infer<typeof transferStockSchema>;

export const listInventoryItemsQuerySchema = z.object({
  lowStockOnly: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
  search: z.string().trim().min(1).max(150).optional(),
});
export type ListInventoryItemsQueryInput = z.infer<typeof listInventoryItemsQuerySchema>;

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(150),
  contactName: z.string().trim().max(150).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(400).optional(),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export const purchaseOrderItemInputSchema = z.object({
  ingredientId: z.string().trim().min(1),
  unitId: z.string().trim().min(1),
  quantityOrdered: quantityString,
  unitCost: costString,
});
export type PurchaseOrderItemInput = z.infer<typeof purchaseOrderItemInputSchema>;

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().trim().min(1),
  expectedAt: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(purchaseOrderItemInputSchema).min(1, 'A purchase order needs at least one line item.'),
});
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

export const updatePurchaseOrderSchema = z.object({
  expectedAt: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(purchaseOrderItemInputSchema).min(1).optional(),
});
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;

export const receivePurchaseOrderItemInputSchema = z.object({
  purchaseOrderItemId: z.string().trim().min(1),
  quantityReceived: quantityString,
});
export const receivePurchaseOrderSchema = z.object({
  items: z.array(receivePurchaseOrderItemInputSchema).min(1),
});
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;

export const cancelPurchaseOrderSchema = z.object({
  cancellationReason: z.string().trim().min(1).max(500),
});
export type CancelPurchaseOrderInput = z.infer<typeof cancelPurchaseOrderSchema>;

export const listPurchaseOrdersQuerySchema = z.object({
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
});
export type ListPurchaseOrdersQueryInput = z.infer<typeof listPurchaseOrdersQuerySchema>;

// ---------------------------------------------------------------------------
// Stock counts
// ---------------------------------------------------------------------------

export const createStockCountSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
});
export type CreateStockCountInput = z.infer<typeof createStockCountSchema>;

export const completeStockCountItemInputSchema = z.object({
  inventoryItemId: z.string().trim().min(1),
  countedQuantity: nonNegativeQuantityString,
});
export const completeStockCountSchema = z.object({
  items: z.array(completeStockCountItemInputSchema).min(1, 'At least one counted line is required.'),
});
export type CompleteStockCountInput = z.infer<typeof completeStockCountSchema>;

export const listStockCountsQuerySchema = z.object({
  status: z.enum(STOCK_COUNT_STATUSES).optional(),
});
export type ListStockCountsQueryInput = z.infer<typeof listStockCountsQuerySchema>;
