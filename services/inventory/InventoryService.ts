import 'server-only';
import { Prisma } from '@prisma/client';
import type { InventoryTransactionType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { convertQuantity, assertSingleLevelChain, type UnitLike } from '@/lib/inventory/units';
import { AccountingService } from '@/services/accounting/AccountingService';
import { log } from '@/lib/monitoring/logger';
import type {
  CreateUnitInput,
  UpdateUnitInput,
  CreateIngredientInput,
  UpdateIngredientInput,
  CreateRecipeInput,
  UpdateRecipeInput,
  CreateInventoryItemInput,
  UpdateInventoryItemInput,
  RecordAdjustmentInput,
  RecordWasteInput,
  TransferStockInput,
  ListInventoryItemsQueryInput,
  CreateSupplierInput,
  UpdateSupplierInput,
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
  ReceivePurchaseOrderInput,
  CancelPurchaseOrderInput,
  ListPurchaseOrdersQueryInput,
  CreateStockCountInput,
  CompleteStockCountInput,
  ListStockCountsQueryInput,
} from '@/lib/validation/inventory';

type Tx = Prisma.TransactionClient;

const INVENTORY_ITEM_INCLUDE = {
  ingredient: { include: { stockUnit: true } },
} satisfies Prisma.InventoryItemInclude;

export class InventoryService {
  // ===========================================================================
  // Units
  // ===========================================================================

  static async listUnits(organizationId: string) {
    return prisma.unit.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
  }

  static async createUnit(organizationId: string, input: CreateUnitInput, actorUserId: string) {
    let baseUnit = null;
    if (input.baseUnitId) {
      baseUnit = await prisma.unit.findFirst({ where: { id: input.baseUnitId, organizationId } });
      if (!baseUnit) throw new NotFoundError('Base unit');
      assertSingleLevelChain({ id: 'new', baseUnitId: input.baseUnitId, conversionFactor: input.conversionFactor }, baseUnit);
    }

    return prisma.$transaction(async (tx) => {
      const unit = await tx.unit.create({
        data: {
          organizationId,
          name: input.name,
          abbreviation: input.abbreviation,
          baseUnitId: input.baseUnitId,
          conversionFactor: input.conversionFactor,
        },
      });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'unit.create', entityType: 'Unit', entityId: unit.id, newValue: unit,
      });
      return unit;
    });
  }

  static async updateUnit(organizationId: string, unitId: string, input: UpdateUnitInput, actorUserId: string) {
    const existing = await prisma.unit.findFirst({ where: { id: unitId, organizationId } });
    if (!existing) throw new NotFoundError('Unit');

    return prisma.$transaction(async (tx) => {
      const unit = await tx.unit.update({ where: { id: unitId }, data: input });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'unit.update', entityType: 'Unit', entityId: unit.id, previousValue: existing, newValue: unit,
      });
      return unit;
    });
  }

  // ===========================================================================
  // Ingredients
  // ===========================================================================

  static async listIngredients(organizationId: string, search?: string) {
    return prisma.ingredient.findMany({
      where: {
        organizationId,
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      include: { stockUnit: true },
      orderBy: { name: 'asc' },
    });
  }

  static async getIngredient(organizationId: string, ingredientId: string) {
    const ingredient = await prisma.ingredient.findFirst({
      where: { id: ingredientId, organizationId },
      include: { stockUnit: true },
    });
    if (!ingredient) throw new NotFoundError('Ingredient');
    return ingredient;
  }

  static async createIngredient(organizationId: string, input: CreateIngredientInput, actorUserId: string) {
    const unit = await prisma.unit.findFirst({ where: { id: input.stockUnitId, organizationId } });
    if (!unit) throw new NotFoundError('Unit');

    return prisma.$transaction(async (tx) => {
      const ingredient = await tx.ingredient.create({
        data: {
          organizationId,
          name: input.name,
          stockUnitId: input.stockUnitId,
          costPerUnit: input.costPerUnit,
        },
      });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'ingredient.create', entityType: 'Ingredient', entityId: ingredient.id, newValue: ingredient,
      });
      return ingredient;
    });
  }

  static async updateIngredient(organizationId: string, ingredientId: string, input: UpdateIngredientInput, actorUserId: string) {
    const existing = await this.assertIngredientInOrg(organizationId, ingredientId);

    return prisma.$transaction(async (tx) => {
      const ingredient = await tx.ingredient.update({ where: { id: ingredientId }, data: input });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'ingredient.update', entityType: 'Ingredient', entityId: ingredient.id,
        previousValue: existing, newValue: ingredient,
      });
      return ingredient;
    });
  }

  static async assertIngredientInOrg(organizationId: string, ingredientId: string) {
    const ingredient = await prisma.ingredient.findFirst({ where: { id: ingredientId, organizationId } });
    if (!ingredient) throw new NotFoundError('Ingredient');
    return ingredient;
  }

  // ===========================================================================
  // Recipes — one per MenuItem. See schema.prisma's "Phase 9 — Inventory"
  // comment block #4 for why variant/modifier-level recipes are out of
  // scope this phase.
  // ===========================================================================

  static async getRecipeByMenuItem(organizationId: string, menuItemId: string) {
    return prisma.recipe.findFirst({
      where: { menuItemId, organizationId },
      include: { items: { include: { ingredient: true, unit: true } } },
    });
  }

  static async getRecipe(organizationId: string, recipeId: string) {
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, organizationId },
      include: { items: { include: { ingredient: true, unit: true } } },
    });
    if (!recipe) throw new NotFoundError('Recipe');
    return recipe;
  }

  static async createRecipe(organizationId: string, input: CreateRecipeInput, actorUserId: string) {
    const menuItem = await prisma.menuItem.findFirst({ where: { id: input.menuItemId, organizationId } });
    if (!menuItem) throw new NotFoundError('Menu item');
    const existing = await prisma.recipe.findUnique({ where: { menuItemId: input.menuItemId } });
    if (existing) throw new ConflictError('This menu item already has a recipe. Edit it instead of creating a new one.');

    await this.assertRecipeItemsValid(organizationId, input.items);

    return prisma.$transaction(async (tx) => {
      const recipe = await tx.recipe.create({
        data: {
          organizationId,
          menuItemId: input.menuItemId,
          yieldQuantity: input.yieldQuantity,
          notes: input.notes,
          items: { create: input.items.map((item) => ({ ingredientId: item.ingredientId, quantity: item.quantity, unitId: item.unitId })) },
        },
        include: { items: { include: { ingredient: true, unit: true } } },
      });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'recipe.create', entityType: 'Recipe', entityId: recipe.id, newValue: recipe,
      });
      return recipe;
    });
  }

  static async updateRecipe(organizationId: string, recipeId: string, input: UpdateRecipeInput, actorUserId: string) {
    const existing = await this.getRecipe(organizationId, recipeId);
    if (input.items) await this.assertRecipeItemsValid(organizationId, input.items);

    return prisma.$transaction(async (tx) => {
      if (input.items) {
        await tx.recipeItem.deleteMany({ where: { recipeId } });
      }
      const recipe = await tx.recipe.update({
        where: { id: recipeId },
        data: {
          yieldQuantity: input.yieldQuantity,
          notes: input.notes,
          ...(input.items
            ? { items: { create: input.items.map((item) => ({ ingredientId: item.ingredientId, quantity: item.quantity, unitId: item.unitId })) } }
            : {}),
        },
        include: { items: { include: { ingredient: true, unit: true } } },
      });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'recipe.update', entityType: 'Recipe', entityId: recipe.id, previousValue: existing, newValue: recipe,
      });
      return recipe;
    });
  }

  private static async assertRecipeItemsValid(organizationId: string, items: CreateRecipeInput['items']) {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.ingredientId)) {
        throw new ConflictError('A recipe cannot list the same ingredient twice — combine the quantities into one line.');
      }
      seen.add(item.ingredientId);
      await this.assertIngredientInOrg(organizationId, item.ingredientId);
      const unit = await prisma.unit.findFirst({ where: { id: item.unitId, organizationId } });
      if (!unit) throw new NotFoundError('Unit');
    }
  }

  // ===========================================================================
  // Inventory items (branch-scoped stock lines)
  // ===========================================================================

  static async listInventoryItems(organizationId: string, branchId: string, query: ListInventoryItemsQueryInput) {
    await this.assertBranchInOrg(organizationId, branchId);
    const items = await prisma.inventoryItem.findMany({
      where: {
        organizationId,
        branchId,
        ...(query.search ? { ingredient: { name: { contains: query.search, mode: 'insensitive' } } } : {}),
      },
      include: INVENTORY_ITEM_INCLUDE,
      orderBy: { ingredient: { name: 'asc' } },
    });
    if (!query.lowStockOnly) return items.map((item) => ({ ...item, stockLevel: this.stockLevel(item) }));
    return items
      .map((item) => ({ ...item, stockLevel: this.stockLevel(item) }))
      .filter((item) => item.stockLevel === 'LOW' || item.stockLevel === 'CRITICAL');
  }

  static async getInventoryItem(organizationId: string, branchId: string, inventoryItemId: string) {
    const item = await prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, branchId, organizationId },
      include: INVENTORY_ITEM_INCLUDE,
    });
    if (!item) throw new NotFoundError('Inventory item');
    return { ...item, stockLevel: this.stockLevel(item) };
  }

  static async createInventoryItem(organizationId: string, branchId: string, input: CreateInventoryItemInput, actorUserId: string) {
    await this.assertBranchInOrg(organizationId, branchId);
    await this.assertIngredientInOrg(organizationId, input.ingredientId);
    if (input.reorderPoint !== undefined && input.criticalPoint !== undefined) {
      this.assertThresholdOrder(input.reorderPoint, input.criticalPoint);
    }
    const existing = await prisma.inventoryItem.findUnique({
      where: { branchId_ingredientId: { branchId, ingredientId: input.ingredientId } },
    });
    if (existing) throw new ConflictError('This ingredient already has a stock line at this branch.');

    return prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.create({
        data: {
          organizationId,
          branchId,
          ingredientId: input.ingredientId,
          reorderPoint: input.reorderPoint,
          criticalPoint: input.criticalPoint,
        },
      });
      // Even the very first stock entry gets a transaction row — "every
      // adjustment must have an audit trail" (§14) applies to the starting
      // balance too, not just later changes.
      await this.applyTransaction(tx, {
        organizationId, branchId, inventoryItemId: item.id,
        type: 'ADJUSTMENT', quantityDelta: new Prisma.Decimal(input.initialQuantity),
        referenceType: 'InventoryItem', referenceId: item.id,
        note: 'Initial stock balance',
        recordedByUserId: actorUserId,
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'inventory_item.create', entityType: 'InventoryItem', entityId: item.id, newValue: item,
      });
      return tx.inventoryItem.findUniqueOrThrow({ where: { id: item.id }, include: INVENTORY_ITEM_INCLUDE });
    });
  }

  static async updateInventoryItem(organizationId: string, branchId: string, inventoryItemId: string, input: UpdateInventoryItemInput, actorUserId: string) {
    const existing = await prisma.inventoryItem.findFirst({ where: { id: inventoryItemId, branchId, organizationId } });
    if (!existing) throw new NotFoundError('Inventory item');

    const reorderPoint = input.reorderPoint === undefined ? existing.reorderPoint : input.reorderPoint;
    const criticalPoint = input.criticalPoint === undefined ? existing.criticalPoint : input.criticalPoint;
    if (reorderPoint !== null && criticalPoint !== null) {
      this.assertThresholdOrder(reorderPoint.toString(), criticalPoint.toString());
    }

    return prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.update({
        where: { id: inventoryItemId },
        data: { reorderPoint: input.reorderPoint, criticalPoint: input.criticalPoint },
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'inventory_item.update', entityType: 'InventoryItem', entityId: item.id,
        previousValue: existing, newValue: item,
      });
      return item;
    });
  }

  private static assertThresholdOrder(reorderPoint: string | Prisma.Decimal, criticalPoint: string | Prisma.Decimal) {
    if (new Prisma.Decimal(criticalPoint).gt(new Prisma.Decimal(reorderPoint))) {
      throw new ConflictError('criticalPoint cannot be higher than reorderPoint — critical stock is a more urgent (lower) threshold.');
    }
  }

  private static stockLevel(item: { quantityOnHand: Prisma.Decimal; reorderPoint: Prisma.Decimal | null; criticalPoint: Prisma.Decimal | null }): 'CRITICAL' | 'LOW' | 'OK' {
    if (item.criticalPoint !== null && item.quantityOnHand.lte(item.criticalPoint)) return 'CRITICAL';
    if (item.reorderPoint !== null && item.quantityOnHand.lte(item.reorderPoint)) return 'LOW';
    return 'OK';
  }

  // ===========================================================================
  // Adjustments / waste / transfers
  // ===========================================================================

  static async recordAdjustment(organizationId: string, branchId: string, inventoryItemId: string, input: RecordAdjustmentInput, actorUserId: string) {
    const item = await prisma.inventoryItem.findFirst({ where: { id: inventoryItemId, branchId, organizationId } });
    if (!item) throw new NotFoundError('Inventory item');

    return prisma.$transaction(async (tx) => {
      const { transaction } = await this.applyTransaction(tx, {
        organizationId, branchId, inventoryItemId,
        type: input.type, quantityDelta: new Prisma.Decimal(input.quantityDelta),
        note: input.reason, recordedByUserId: actorUserId,
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'inventory.adjustment', entityType: 'InventoryTransaction', entityId: transaction.id, newValue: transaction,
      });
      return transaction;
    });
  }

  static async recordWaste(organizationId: string, branchId: string, inventoryItemId: string, input: RecordWasteInput, actorUserId: string) {
    const item = await prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, branchId, organizationId },
      include: { ingredient: true },
    });
    if (!item) throw new NotFoundError('Inventory item');

    return prisma.$transaction(async (tx) => {
      const waste = await tx.wasteRecord.create({
        data: {
          organizationId, branchId, inventoryItemId,
          quantity: input.quantity, reason: input.reason, recordedByUserId: actorUserId,
        },
      });
      await this.applyTransaction(tx, {
        organizationId, branchId, inventoryItemId,
        type: 'WASTE', quantityDelta: new Prisma.Decimal(input.quantity).negated(),
        unitCostAtTime: item.ingredient.costPerUnit,
        referenceType: 'WasteRecord', referenceId: waste.id,
        note: input.reason, recordedByUserId: actorUserId,
      });
      // Phase 10 — Accounting. Debit Waste / Credit Inventory, using the
      // same cost the stock ledger just applied above. Each WasteRecord row
      // is its own idempotency key (see AccountingService.recordInventoryWaste).
      await AccountingService.recordInventoryWaste(
        tx, organizationId, branchId,
        { wasteRecordId: waste.id, cost: new Prisma.Decimal(input.quantity).times(item.ingredient.costPerUnit) },
        actorUserId,
      );
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'waste_record.create', entityType: 'WasteRecord', entityId: waste.id, newValue: waste,
      });
      return waste;
    });
  }

  /**
   * Moves stock of one ingredient from one branch to another. Unlike
   * consumption/waste (which record something that already physically
   * happened and must never be blocked by the ledger), a transfer is a
   * deliberate two-sided action staff is choosing to take right now — so
   * this is the one stock-moving operation that DOES check for sufficient
   * source stock and refuses to proceed if the ledger says there isn't
   * enough, rather than letting it go negative.
   */
  static async transferStock(organizationId: string, fromBranchId: string, input: TransferStockInput, actorUserId: string) {
    await this.assertBranchInOrg(organizationId, fromBranchId);
    await this.assertBranchInOrg(organizationId, input.toBranchId);
    if (fromBranchId === input.toBranchId) throw new ConflictError('Cannot transfer stock to the same branch.');
    await this.assertIngredientInOrg(organizationId, input.ingredientId);

    const source = await prisma.inventoryItem.findUnique({
      where: { branchId_ingredientId: { branchId: fromBranchId, ingredientId: input.ingredientId } },
    });
    if (!source) throw new NotFoundError('Source inventory item');
    const quantity = new Prisma.Decimal(input.quantity);
    if (source.quantityOnHand.lt(quantity)) {
      throw new ConflictError(`Insufficient stock to transfer: ${source.quantityOnHand.toString()} on hand, ${quantity.toString()} requested.`);
    }

    return prisma.$transaction(async (tx) => {
      const destination = await tx.inventoryItem.upsert({
        where: { branchId_ingredientId: { branchId: input.toBranchId, ingredientId: input.ingredientId } },
        create: { organizationId, branchId: input.toBranchId, ingredientId: input.ingredientId },
        update: {},
      });

      const outbound = await this.applyTransaction(tx, {
        organizationId, branchId: fromBranchId, inventoryItemId: source.id,
        type: 'TRANSFER', quantityDelta: quantity.negated(),
        referenceType: 'InventoryItem', referenceId: destination.id,
        note: input.note ?? `Transfer out to branch ${input.toBranchId}`,
        recordedByUserId: actorUserId,
      });
      const inbound = await this.applyTransaction(tx, {
        organizationId, branchId: input.toBranchId, inventoryItemId: destination.id,
        type: 'TRANSFER', quantityDelta: quantity,
        referenceType: 'InventoryItem', referenceId: source.id,
        note: input.note ?? `Transfer in from branch ${fromBranchId}`,
        recordedByUserId: actorUserId,
      });

      await writeAuditLog(tx, {
        organizationId, branchId: fromBranchId, userId: actorUserId,
        action: 'inventory.transfer', entityType: 'InventoryTransaction', entityId: outbound.transaction.id,
        newValue: { outbound: outbound.transaction, inbound: inbound.transaction },
      });
      return { outbound: outbound.transaction, inbound: inbound.transaction };
    });
  }

  /**
   * The one place quantityOnHand is ever written. Uses Prisma's atomic
   * `increment` update (a single `SET quantityOnHand = quantityOnHand + $1`
   * at the database level) rather than "read current value, compute new
   * value, write it back" — the latter would race under concurrent writes
   * to the same InventoryItem; this doesn't need to, and always produces a
   * matching InventoryTransaction row in the same DB transaction as the
   * balance change, per schema.prisma's "Phase 9 — Inventory" comment
   * block #2.
   */
  private static async applyTransaction(
    tx: Tx,
    args: {
      organizationId: string;
      branchId: string;
      inventoryItemId: string;
      type: InventoryTransactionType;
      quantityDelta: Prisma.Decimal;
      unitCostAtTime?: Prisma.Decimal | string | null;
      referenceType?: string;
      referenceId?: string;
      note?: string;
      recordedByUserId?: string | null;
    },
  ) {
    const updated = await tx.inventoryItem.update({
      where: { id: args.inventoryItemId },
      data: { quantityOnHand: { increment: args.quantityDelta.toFixed(4) } },
    });
    const transaction = await tx.inventoryTransaction.create({
      data: {
        organizationId: args.organizationId,
        branchId: args.branchId,
        inventoryItemId: args.inventoryItemId,
        type: args.type,
        quantityDelta: args.quantityDelta.toFixed(4),
        quantityAfter: updated.quantityOnHand,
        unitCostAtTime: args.unitCostAtTime ?? undefined,
        referenceType: args.referenceType,
        referenceId: args.referenceId,
        note: args.note,
        recordedByUserId: args.recordedByUserId ?? undefined,
      },
    });
    return { inventoryItem: updated, transaction };
  }

  // ===========================================================================
  // Suppliers
  // ===========================================================================

  static async listSuppliers(organizationId: string) {
    return prisma.supplier.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
  }

  static async createSupplier(organizationId: string, input: CreateSupplierInput, actorUserId: string) {
    const existing = await prisma.supplier.findUnique({ where: { organizationId_name: { organizationId, name: input.name } } });
    if (existing) throw new ConflictError(`A supplier named "${input.name}" already exists.`);

    return prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({ data: { organizationId, ...input } });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'supplier.create', entityType: 'Supplier', entityId: supplier.id, newValue: supplier,
      });
      return supplier;
    });
  }

  static async updateSupplier(organizationId: string, supplierId: string, input: UpdateSupplierInput, actorUserId: string) {
    const existing = await this.assertSupplierInOrg(organizationId, supplierId);

    return prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.update({ where: { id: supplierId }, data: input });
      await writeAuditLog(tx, {
        organizationId, userId: actorUserId,
        action: 'supplier.update', entityType: 'Supplier', entityId: supplier.id, previousValue: existing, newValue: supplier,
      });
      return supplier;
    });
  }

  static async assertSupplierInOrg(organizationId: string, supplierId: string) {
    const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, organizationId } });
    if (!supplier) throw new NotFoundError('Supplier');
    return supplier;
  }

  // ===========================================================================
  // Purchase orders
  // ===========================================================================

  static async listPurchaseOrders(organizationId: string, branchId: string, query: ListPurchaseOrdersQueryInput) {
    await this.assertBranchInOrg(organizationId, branchId);
    // Phase 15 hardening: bounded (previously unbounded — see
    // docs/architecture.md § 23).
    return prisma.purchaseOrder.findMany({
      where: { organizationId, branchId, status: query.status },
      include: { items: { include: { ingredient: true, unit: true } }, supplier: true },
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
    });
  }

  static async getPurchaseOrder(organizationId: string, branchId: string, purchaseOrderId: string) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, branchId, organizationId },
      include: { items: { include: { ingredient: true, unit: true } }, supplier: true },
    });
    if (!po) throw new NotFoundError('Purchase order');
    return po;
  }

  static async createPurchaseOrder(organizationId: string, branchId: string, input: CreatePurchaseOrderInput, actorUserId: string) {
    await this.assertBranchInOrg(organizationId, branchId);
    await this.assertSupplierInOrg(organizationId, input.supplierId);
    for (const item of input.items) {
      await this.assertIngredientInOrg(organizationId, item.ingredientId);
      const unit = await prisma.unit.findFirst({ where: { id: item.unitId, organizationId } });
      if (!unit) throw new NotFoundError('Unit');
    }
    const { items, total } = this.computePurchaseOrderTotals(input.items);

    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          organizationId, branchId, supplierId: input.supplierId,
          status: 'DRAFT', total: total.toFixed(2),
          expectedAt: input.expectedAt ? new Date(input.expectedAt) : undefined,
          notes: input.notes, createdByUserId: actorUserId,
          items: { create: items },
        },
        include: { items: { include: { ingredient: true, unit: true } }, supplier: true },
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'purchase_order.create', entityType: 'PurchaseOrder', entityId: po.id, newValue: po,
      });
      return po;
    });
  }

  static async updatePurchaseOrder(organizationId: string, branchId: string, purchaseOrderId: string, input: UpdatePurchaseOrderInput, actorUserId: string) {
    const existing = await this.getPurchaseOrder(organizationId, branchId, purchaseOrderId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictError(`Cannot edit a purchase order once it is ${existing.status} — only DRAFT purchase orders may be amended.`);
    }
    let items: Array<{ ingredientId: string; unitId: string; quantityOrdered: string; unitCost: string; lineTotal: string }> | undefined;
    let total = existing.total;
    if (input.items) {
      for (const item of input.items) {
        await this.assertIngredientInOrg(organizationId, item.ingredientId);
        const unit = await prisma.unit.findFirst({ where: { id: item.unitId, organizationId } });
        if (!unit) throw new NotFoundError('Unit');
      }
      const computed = this.computePurchaseOrderTotals(input.items);
      items = computed.items;
      total = computed.total;
    }

    return prisma.$transaction(async (tx) => {
      if (items) await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId } });
      const po = await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          expectedAt: input.expectedAt ? new Date(input.expectedAt) : undefined,
          notes: input.notes,
          total: total.toFixed(2),
          ...(items ? { items: { create: items } } : {}),
        },
        include: { items: { include: { ingredient: true, unit: true } }, supplier: true },
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'purchase_order.update', entityType: 'PurchaseOrder', entityId: po.id, previousValue: existing, newValue: po,
      });
      return po;
    });
  }

  static async submitPurchaseOrder(organizationId: string, branchId: string, purchaseOrderId: string, actorUserId: string) {
    const existing = await this.getPurchaseOrder(organizationId, branchId, purchaseOrderId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictError(`Cannot submit a purchase order that is ${existing.status} — only DRAFT purchase orders can be submitted.`);
    }

    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
        include: { items: { include: { ingredient: true, unit: true } }, supplier: true },
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'purchase_order.submit', entityType: 'PurchaseOrder', entityId: po.id, previousValue: { status: existing.status }, newValue: { status: po.status },
      });
      return po;
    });
  }

  static async cancelPurchaseOrder(organizationId: string, branchId: string, purchaseOrderId: string, input: CancelPurchaseOrderInput, actorUserId: string) {
    const existing = await this.getPurchaseOrder(organizationId, branchId, purchaseOrderId);
    if (existing.status !== 'DRAFT' && existing.status !== 'SUBMITTED') {
      throw new ConflictError(`Cannot cancel a purchase order that is ${existing.status}.`);
    }

    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: 'CANCELLED', cancellationReason: input.cancellationReason },
        include: { items: { include: { ingredient: true, unit: true } }, supplier: true },
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'purchase_order.cancel', entityType: 'PurchaseOrder', entityId: po.id, previousValue: { status: existing.status }, newValue: { status: po.status, cancellationReason: input.cancellationReason },
      });
      return po;
    });
  }

  /**
   * Receives some or all of a submitted purchase order's line items.
   * Partial receiving is a first-class case (a delivery arrives short, or
   * split across trucks) — each call adds to quantityReceived rather than
   * replacing it, and the order's status only becomes RECEIVED once every
   * line is fully received. Auto-creates the destination InventoryItem if
   * this is the first time this ingredient has been stocked at this
   * branch — unlike every other stock-affecting operation, which requires
   * an InventoryItem to already exist, receiving a PO is how a branch
   * commonly starts stocking something new.
   */
  static async receivePurchaseOrderItems(organizationId: string, branchId: string, purchaseOrderId: string, input: ReceivePurchaseOrderInput, actorUserId: string) {
    const po = await this.getPurchaseOrder(organizationId, branchId, purchaseOrderId);
    if (po.status !== 'SUBMITTED' && po.status !== 'PARTIALLY_RECEIVED') {
      throw new ConflictError(`Cannot receive against a purchase order that is ${po.status}.`);
    }

    // Explicit type argument — see OrderService.ts's identical comment on
    // `menuItemById` for why (a TS-compiler-in-this-sandbox quirk from
    // node_modules not existing here, not a real type issue).
    const poItemById = new Map<string, (typeof po.items)[number]>(po.items.map((item) => [item.id, item]));
    for (const line of input.items) {
      const poItem = poItemById.get(line.purchaseOrderItemId);
      if (!poItem) throw new NotFoundError('Purchase order item');
      const newTotalReceived = poItem.quantityReceived.plus(new Prisma.Decimal(line.quantityReceived));
      if (newTotalReceived.gt(poItem.quantityOrdered)) {
        throw new ConflictError(
          `Cannot receive ${line.quantityReceived} of an item — only ${poItem.quantityOrdered.minus(poItem.quantityReceived).toString()} remains unreceived.`,
        );
      }
    }

    return prisma.$transaction(async (tx) => {
      // Phase 10 — Accounting. Accumulated across every line received in
      // THIS call, and anchored to the id of the first InventoryTransaction
      // row this call creates — see AccountingService.recordInventoryPurchase
      // for why the idempotency key is per-receiving-call, not per-PO (a PO
      // can legitimately be received against multiple times).
      let totalReceiptCost = new Prisma.Decimal(0);
      let anchorTransactionId: string | undefined;

      for (const line of input.items) {
        const poItem = poItemById.get(line.purchaseOrderItemId)!;
        const ingredient = await tx.ingredient.findUniqueOrThrow({ where: { id: poItem.ingredientId }, include: { stockUnit: true } });
        const poUnit = poItem.unit as unknown as UnitLike;
        const stockUnit = ingredient.stockUnit as unknown as UnitLike;

        const receivedQty = new Prisma.Decimal(line.quantityReceived);
        const convertedQty = convertQuantity(poUnit, stockUnit, receivedQty);
        // Cost per stock-unit, derived from this receipt's own numbers
        // (receivedQty × unitCost is exact in the PO's native unit; dividing
        // by the converted stock-unit quantity gives the equivalent
        // per-stock-unit cost without compounding conversion rounding).
        const receiptCost = receivedQty.times(poItem.unitCost);
        const costPerStockUnit = convertedQty.isZero() ? poItem.unitCost : receiptCost.dividedBy(convertedQty);

        const inventoryItem = await tx.inventoryItem.upsert({
          where: { branchId_ingredientId: { branchId, ingredientId: poItem.ingredientId } },
          create: { organizationId, branchId, ingredientId: poItem.ingredientId },
          update: {},
        });

        const { transaction: purchaseTransaction } = await this.applyTransaction(tx, {
          organizationId, branchId, inventoryItemId: inventoryItem.id,
          type: 'PURCHASE', quantityDelta: convertedQty,
          unitCostAtTime: costPerStockUnit,
          referenceType: 'PurchaseOrder', referenceId: purchaseOrderId,
          note: `Received against PO ${purchaseOrderId}`,
          recordedByUserId: actorUserId,
        });
        totalReceiptCost = totalReceiptCost.plus(receiptCost);
        if (!anchorTransactionId) anchorTransactionId = purchaseTransaction.id;

        // "Last purchase cost wins" — the ingredient's costPerUnit always
        // reflects the most recent purchase, driving future COGS/waste-cost
        // calculations until the next receipt updates it again.
        await tx.ingredient.update({ where: { id: poItem.ingredientId }, data: { costPerUnit: costPerStockUnit.toFixed(4) } });

        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: { quantityReceived: { increment: receivedQty.toFixed(4) } },
        });
      }

      if (totalReceiptCost.gt(0) && anchorTransactionId) {
        await AccountingService.recordInventoryPurchase(
          tx, organizationId, branchId,
          { purchaseOrderId, anchorTransactionId, totalCost: totalReceiptCost },
          actorUserId,
        );
      }

      const refreshedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId } });
      const fullyReceived = refreshedItems.every((item) => item.quantityReceived.gte(item.quantityOrdered));
      const newStatus = fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';

      const updatedPo = await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: newStatus, receivedAt: fullyReceived ? new Date() : po.receivedAt },
        include: { items: { include: { ingredient: true, unit: true } }, supplier: true },
      });

      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'purchase_order.receive', entityType: 'PurchaseOrder', entityId: purchaseOrderId,
        previousValue: { status: po.status }, newValue: { status: newStatus, items: input.items },
      });

      return updatedPo;
    });
  }

  private static computePurchaseOrderTotals(items: CreatePurchaseOrderInput['items']) {
    let total = new Prisma.Decimal(0);
    const computed = items.map((item) => {
      const lineTotal = new Prisma.Decimal(item.quantityOrdered).times(item.unitCost);
      total = total.plus(lineTotal);
      return {
        ingredientId: item.ingredientId,
        unitId: item.unitId,
        quantityOrdered: item.quantityOrdered,
        unitCost: item.unitCost,
        lineTotal: lineTotal.toFixed(2),
      };
    });
    return { items: computed, total };
  }

  // ===========================================================================
  // Stock counts
  // ===========================================================================

  static async listStockCounts(organizationId: string, branchId: string, query: ListStockCountsQueryInput) {
    await this.assertBranchInOrg(organizationId, branchId);
    // Phase 15 hardening: bounded (previously unbounded — see
    // docs/architecture.md § 23).
    return prisma.stockCount.findMany({
      where: { organizationId, branchId, status: query.status },
      include: { items: { include: { inventoryItem: { include: INVENTORY_ITEM_INCLUDE } } } },
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
    });
  }

  static async getStockCount(organizationId: string, branchId: string, stockCountId: string) {
    const count = await prisma.stockCount.findFirst({
      where: { id: stockCountId, branchId, organizationId },
      include: { items: { include: { inventoryItem: { include: INVENTORY_ITEM_INCLUDE } } } },
    });
    if (!count) throw new NotFoundError('Stock count');
    return count;
  }

  /** Snapshots every current InventoryItem at this branch as an open count line. */
  static async createStockCount(organizationId: string, branchId: string, input: CreateStockCountInput, actorUserId: string) {
    await this.assertBranchInOrg(organizationId, branchId);
    const items = await prisma.inventoryItem.findMany({ where: { organizationId, branchId } });

    return prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.create({
        data: {
          organizationId, branchId, notes: input.notes, recordedByUserId: actorUserId,
          items: { create: items.map((item) => ({ inventoryItemId: item.id, expectedQuantity: item.quantityOnHand })) },
        },
        include: { items: { include: { inventoryItem: { include: INVENTORY_ITEM_INCLUDE } } } },
      });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'stock_count.create', entityType: 'StockCount', entityId: count.id, newValue: { itemCount: items.length },
      });
      return count;
    });
  }

  static async cancelStockCount(organizationId: string, branchId: string, stockCountId: string, actorUserId: string) {
    const existing = await this.getStockCount(organizationId, branchId, stockCountId);
    if (existing.status !== 'OPEN') throw new ConflictError(`Cannot cancel a stock count that is ${existing.status}.`);

    return prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.update({ where: { id: stockCountId }, data: { status: 'CANCELLED' } });
      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'stock_count.cancel', entityType: 'StockCount', entityId: count.id, previousValue: { status: existing.status }, newValue: { status: count.status },
      });
      return count;
    });
  }

  /**
   * Records counted quantities for some or all lines of an open stock
   * count, applying a COUNT_CORRECTION transaction for every line whose
   * counted quantity differs from the CURRENT quantityOnHand (not the
   * open-time `expectedQuantity` snapshot) — the physical count is ground
   * truth for what's on the shelf right now, and any transactions that
   * happened during the counting window (a sale, a delivery) already
   * correctly happened and must not be silently overwritten by a stale
   * snapshot-based delta. `expectedQuantity` remains on the row purely as
   * the open-time snapshot for variance reporting ("how much drifted since
   * this count started"), not as the correction's baseline.
   */
  static async completeStockCount(organizationId: string, branchId: string, stockCountId: string, input: CompleteStockCountInput, actorUserId: string) {
    const existing = await this.getStockCount(organizationId, branchId, stockCountId);
    if (existing.status !== 'OPEN') throw new ConflictError(`Cannot record counts against a stock count that is ${existing.status}.`);

    const lineByInventoryItemId = new Map<string, (typeof existing.items)[number]>(existing.items.map((line) => [line.inventoryItemId, line]));
    for (const line of input.items) {
      if (!lineByInventoryItemId.has(line.inventoryItemId)) {
        throw new NotFoundError('Stock count line for that inventory item');
      }
    }

    return prisma.$transaction(async (tx) => {
      for (const line of input.items) {
        const stockCountLine = lineByInventoryItemId.get(line.inventoryItemId)!;
        const counted = new Prisma.Decimal(line.countedQuantity);
        const current = await tx.inventoryItem.findUniqueOrThrow({ where: { id: line.inventoryItemId } });
        const variance = counted.minus(current.quantityOnHand);

        await tx.stockCountItem.update({
          where: { id: stockCountLine.id },
          data: { countedQuantity: counted.toFixed(4) },
        });

        if (!variance.isZero()) {
          await this.applyTransaction(tx, {
            organizationId, branchId, inventoryItemId: line.inventoryItemId,
            type: 'COUNT_CORRECTION', quantityDelta: variance,
            referenceType: 'StockCount', referenceId: stockCountId,
            note: `Stock count correction (counted ${counted.toString()})`,
            recordedByUserId: actorUserId,
          });
        }
      }

      const refreshedLines = await tx.stockCountItem.findMany({ where: { stockCountId } });
      const allCounted = refreshedLines.every((line) => line.countedQuantity !== null);

      const count = await tx.stockCount.update({
        where: { id: stockCountId },
        data: allCounted ? { status: 'COMPLETED', completedAt: new Date() } : {},
        include: { items: { include: { inventoryItem: { include: INVENTORY_ITEM_INCLUDE } } } },
      });

      await writeAuditLog(tx, {
        organizationId, branchId, userId: actorUserId,
        action: 'stock_count.record', entityType: 'StockCount', entityId: stockCountId,
        newValue: { items: input.items, status: count.status },
      });

      return count;
    });
  }

  // ===========================================================================
  // Recipe-based consumption on order completion + COGS
  // ===========================================================================

  /**
   * Called from OrderService.updateStatus's COMPLETED transition, inside
   * that same transaction (tx is passed in, not opened here) — the "one
   * business event, one transaction" discipline every cross-service side
   * effect in this codebase follows (Phase 6's Order→DeliveryOrder,
   * Phase 7's CateringQuote ACCEPTED→CateringEvent). Best-effort by
   * design: an order item whose menu item has no recipe, an ingredient
   * with no InventoryItem at this branch, or a recipe/order unit mismatch
   * are all silently skipped rather than thrown — completing a food order
   * must never be blocked by inventory catalog/config gaps. See
   * schema.prisma's "Phase 9 — Inventory" comment block #4 for the
   * variant/modifier consumption scope boundary this implies.
   */
  static async consumeForOrder(
    tx: Tx,
    organizationId: string,
    branchId: string,
    orderId: string,
    orderItems: Array<{ menuItemId: string; quantity: number }>,
    actorUserId: string,
  ): Promise<Prisma.Decimal> {
    // Phase 10 — Accounting. Accumulated as consumption is applied so
    // OrderService.updateStatus can pass the exact figure straight into
    // AccountingService.recordOrderRevenue without a second query inside
    // the same open transaction (see getCogsForOrder below for the
    // equivalent read-after-the-fact query, used where no open tx exists).
    let cogs = new Prisma.Decimal(0);

    for (const orderItem of orderItems) {
      const recipe = await tx.recipe.findUnique({
        where: { menuItemId: orderItem.menuItemId },
        include: { items: { include: { ingredient: { include: { stockUnit: true } }, unit: true } } },
      });
      if (!recipe) continue;

      for (const recipeItem of recipe.items) {
        const inventoryItem = await tx.inventoryItem.findUnique({
          where: { branchId_ingredientId: { branchId, ingredientId: recipeItem.ingredientId } },
        });
        if (!inventoryItem) continue;

        const requiredQty = recipeItem.quantity.times(orderItem.quantity).dividedBy(recipe.yieldQuantity);
        let convertedQty: Prisma.Decimal;
        try {
          convertedQty = convertQuantity(recipeItem.unit as unknown as UnitLike, recipeItem.ingredient.stockUnit as unknown as UnitLike, requiredQty);
        } catch (error) {
          // Incompatible recipe-unit/stock-unit config — a data problem,
          // not something a customer's order should ever fail over. Logged
          // (§63 Observability) so an owner/admin can find and fix the
          // misconfigured recipe/ingredient — silently skipping consumption
          // for this ingredient would otherwise leave stock levels quietly
          // wrong with no trace of why.
          log.warn('InventoryService.consumeForOrder: skipping ingredient with incompatible recipe/stock unit', {
            organizationId, branchId, orderId, ingredientId: recipeItem.ingredientId,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        await this.applyTransaction(tx, {
          organizationId, branchId, inventoryItemId: inventoryItem.id,
          type: 'SALE_CONSUMPTION', quantityDelta: convertedQty.negated(),
          unitCostAtTime: recipeItem.ingredient.costPerUnit,
          referenceType: 'Order', referenceId: orderId,
          recordedByUserId: actorUserId,
        });
        cogs = cogs.plus(convertedQty.times(recipeItem.ingredient.costPerUnit));
      }
    }

    return cogs;
  }

  /** Sums the real ingredient cost of every SALE_CONSUMPTION row tied to an order — this phase's slice of §37's "ingredient consumption -> COGS increases." */
  static async getCogsForOrder(organizationId: string, branchId: string, orderId: string) {
    const rows = await prisma.inventoryTransaction.findMany({
      where: { organizationId, branchId, referenceType: 'Order', referenceId: orderId, type: 'SALE_CONSUMPTION' },
    });
    return rows.reduce(
      (sum, row) => sum.plus(row.quantityDelta.negated().times(row.unitCostAtTime ?? 0)),
      new Prisma.Decimal(0),
    );
  }

  // ===========================================================================
  // Low stock
  // ===========================================================================

  static async getLowStockItems(organizationId: string, branchId: string) {
    await this.assertBranchInOrg(organizationId, branchId);
    const items = await prisma.inventoryItem.findMany({
      where: { organizationId, branchId, reorderPoint: { not: null } },
      include: INVENTORY_ITEM_INCLUDE,
    });
    return items
      .map((item) => ({ ...item, stockLevel: this.stockLevel(item) }))
      .filter((item) => item.stockLevel !== 'OK');
  }

  /**
   * Org-wide count (across every branch), for the dashboard overview card —
   * Prisma's query builder has no column-to-column comparison
   * (quantityOnHand <= reorderPoint), so this filters in application code
   * the same way getLowStockItems does, just without a branch scope.
   */
  static async getLowStockCount(organizationId: string) {
    const items = await prisma.inventoryItem.findMany({
      where: { organizationId, reorderPoint: { not: null } },
      select: { quantityOnHand: true, reorderPoint: true, criticalPoint: true },
    });
    return items.filter((item) => this.stockLevel(item) !== 'OK').length;
  }

  private static async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }
}
