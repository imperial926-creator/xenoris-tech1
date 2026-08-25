import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { emitRealtimeEvent } from '@/lib/realtime/emit';
import type {
  CreateMenuCategoryInput,
  CreateMenuItemInput,
  CreateMenuItemVariantInput,
  CreateModifierGroupInput,
  CreateModifierInput,
  UpdateMenuCategoryInput,
  UpdateMenuItemInput,
} from '@/lib/validation/menu';
import type { CreateMenuItemRecommendationInput } from '@/lib/validation/menu-recommendation';

export class MenuService {
  // --- Categories ---------------------------------------------------------

  static async listCategories(organizationId: string) {
    return prisma.menuCategory.findMany({
      where: { organizationId },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  static async createCategory(
    organizationId: string,
    input: CreateMenuCategoryInput,
    actorUserId: string,
  ) {
    const existing = await prisma.menuCategory.findUnique({
      where: { organizationId_name: { organizationId, name: input.name } },
    });
    if (existing) throw new ConflictError(`A category named "${input.name}" already exists.`);

    return prisma.$transaction(async (tx) => {
      const category = await tx.menuCategory.create({ data: { organizationId, ...input } });
      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: 'menu_category.create',
        entityType: 'MenuCategory',
        entityId: category.id,
        newValue: category,
      });
      return category;
    });
  }

  static async updateCategory(
    organizationId: string,
    categoryId: string,
    input: UpdateMenuCategoryInput,
    actorUserId: string,
  ) {
    const existing = await this.getCategory(organizationId, categoryId);
    return prisma.$transaction(async (tx) => {
      const category = await tx.menuCategory.update({ where: { id: categoryId }, data: input });
      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: 'menu_category.update',
        entityType: 'MenuCategory',
        entityId: category.id,
        previousValue: existing,
        newValue: category,
      });
      return category;
    });
  }

  static async getCategory(organizationId: string, categoryId: string) {
    const category = await prisma.menuCategory.findFirst({
      where: { id: categoryId, organizationId },
    });
    if (!category) throw new NotFoundError('Menu category');
    return category;
  }

  // --- Items ----------------------------------------------------------

  static async listItems(organizationId: string, categoryId?: string) {
    return prisma.menuItem.findMany({
      where: { organizationId, ...(categoryId ? { categoryId } : {}) },
      include: { category: true, variants: true, modifierGroups: { include: { modifierGroup: { include: { modifiers: true } } } } },
      orderBy: { name: 'asc' },
    });
  }

  static async getItem(organizationId: string, itemId: string) {
    const item = await prisma.menuItem.findFirst({
      where: { id: itemId, organizationId },
      include: { category: true, variants: true, modifierGroups: { include: { modifierGroup: { include: { modifiers: true } } } } },
    });
    if (!item) throw new NotFoundError('Menu item');
    return item;
  }

  static async createItem(organizationId: string, input: CreateMenuItemInput, actorUserId: string) {
    // Validate the category belongs to this org before creating — Prisma's
    // FK would also catch a bogus id, but this gives a clean 404 instead of
    // a raw constraint-violation 500.
    await this.getCategory(organizationId, input.categoryId);

    return prisma.$transaction(async (tx) => {
      const item = await tx.menuItem.create({
        data: {
          organizationId,
          categoryId: input.categoryId,
          name: input.name,
          description: input.description,
          price: input.price,
          cost: input.cost,
          preparationTimeMinutes: input.preparationTimeMinutes,
          available: input.available,
          imageUrl: input.imageUrl,
          taxCategory: input.taxCategory,
        },
      });
      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: 'menu_item.create',
        entityType: 'MenuItem',
        entityId: item.id,
        newValue: item,
      });
      return item;
    });
  }

  static async updateItem(
    organizationId: string,
    itemId: string,
    input: UpdateMenuItemInput,
    actorUserId: string,
  ) {
    const existing = await this.getItem(organizationId, itemId);
    if (input.categoryId) {
      await this.getCategory(organizationId, input.categoryId);
    }

    return prisma.$transaction(async (tx) => {
      const item = await tx.menuItem.update({ where: { id: itemId }, data: input });
      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: 'menu_item.update',
        entityType: 'MenuItem',
        entityId: item.id,
        previousValue: existing,
        newValue: item,
      });

      // CAPP Phase 7 — spec § 43 "MenuItemAvailabilityChanged". Only fires
      // on an actual flip of `available` (not every unrelated edit, like a
      // price/description change), and has no `customerAccountId` — this is
      // a broadcast event, delivered to every connected client whether
      // signed in or not, since a diner browsing the menu without an
      // account still needs to see it go on/off in real time. MenuItem is
      // organization-wide (no branchId column — see schema.prisma), so the
      // payload carries none either.
      if (existing.available !== item.available) {
        await emitRealtimeEvent(tx, {
          organizationId,
          type: 'MenuItemAvailabilityChanged',
          payload: { menuItemId: item.id, available: item.available },
        });
      }

      return item;
    });
  }

  // --- Variants ---------------------------------------------------------

  static async addVariant(
    organizationId: string,
    itemId: string,
    input: CreateMenuItemVariantInput,
    actorUserId: string,
  ) {
    await this.getItem(organizationId, itemId);
    const existing = await prisma.menuItemVariant.findUnique({
      where: { menuItemId_name: { menuItemId: itemId, name: input.name } },
    });
    if (existing) throw new ConflictError(`A variant named "${input.name}" already exists for this item.`);

    return prisma.$transaction(async (tx) => {
      const variant = await tx.menuItemVariant.create({ data: { menuItemId: itemId, ...input } });
      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: 'menu_item_variant.create',
        entityType: 'MenuItemVariant',
        entityId: variant.id,
        newValue: variant,
      });
      return variant;
    });
  }

  // --- Modifier groups & modifiers ---------------------------------------

  static async listModifierGroups(organizationId: string) {
    return prisma.menuModifierGroup.findMany({
      where: { organizationId },
      include: { modifiers: true },
      orderBy: { name: 'asc' },
    });
  }

  static async createModifierGroup(
    organizationId: string,
    input: CreateModifierGroupInput,
    actorUserId: string,
  ) {
    const existing = await prisma.menuModifierGroup.findUnique({
      where: { organizationId_name: { organizationId, name: input.name } },
    });
    if (existing) throw new ConflictError(`A modifier group named "${input.name}" already exists.`);

    return prisma.$transaction(async (tx) => {
      const group = await tx.menuModifierGroup.create({ data: { organizationId, ...input } });
      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: 'menu_modifier_group.create',
        entityType: 'MenuModifierGroup',
        entityId: group.id,
        newValue: group,
      });
      return group;
    });
  }

  static async getModifierGroup(organizationId: string, groupId: string) {
    const group = await prisma.menuModifierGroup.findFirst({
      where: { id: groupId, organizationId },
      include: { modifiers: true },
    });
    if (!group) throw new NotFoundError('Modifier group');
    return group;
  }

  static async addModifier(
    organizationId: string,
    groupId: string,
    input: CreateModifierInput,
    actorUserId: string,
  ) {
    await this.getModifierGroup(organizationId, groupId);
    const existing = await prisma.menuModifier.findUnique({
      where: { modifierGroupId_name: { modifierGroupId: groupId, name: input.name } },
    });
    if (existing) throw new ConflictError(`A modifier named "${input.name}" already exists in this group.`);

    return prisma.$transaction(async (tx) => {
      const modifier = await tx.menuModifier.create({ data: { modifierGroupId: groupId, ...input } });
      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: 'menu_modifier.create',
        entityType: 'MenuModifier',
        entityId: modifier.id,
        newValue: modifier,
      });
      return modifier;
    });
  }

  static async linkModifierGroupToItem(
    organizationId: string,
    itemId: string,
    modifierGroupId: string,
    actorUserId: string,
  ) {
    await this.getItem(organizationId, itemId);
    await this.getModifierGroup(organizationId, modifierGroupId);

    const existing = await prisma.menuItemModifierGroup.findUnique({
      where: { menuItemId_modifierGroupId: { menuItemId: itemId, modifierGroupId } },
    });
    if (existing) throw new ConflictError('This modifier group is already linked to this item.');

    return prisma.$transaction(async (tx) => {
      const link = await tx.menuItemModifierGroup.create({
        data: { menuItemId: itemId, modifierGroupId },
      });
      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: 'menu_item.link_modifier_group',
        entityType: 'MenuItem',
        entityId: itemId,
        newValue: { modifierGroupId },
      });
      return link;
    });
  }

  // --- Recommendations (CAPP Phase 10 — spec § 39 "Upselling") ------------

  static async listRecommendations(organizationId: string, itemId: string) {
    await this.getItem(organizationId, itemId);
    return prisma.menuItemRecommendation.findMany({
      where: { organizationId, menuItemId: itemId },
      include: { recommendedMenuItem: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  static async addRecommendation(
    organizationId: string,
    itemId: string,
    input: CreateMenuItemRecommendationInput,
    actorUserId: string,
  ) {
    await this.getItem(organizationId, itemId);
    if (input.recommendedMenuItemId === itemId) {
      throw new ConflictError('An item cannot recommend itself.');
    }
    const target = await prisma.menuItem.findFirst({ where: { id: input.recommendedMenuItemId, organizationId } });
    if (!target) throw new NotFoundError('Recommended menu item');

    const existing = await prisma.menuItemRecommendation.findUnique({
      where: { menuItemId_recommendedMenuItemId: { menuItemId: itemId, recommendedMenuItemId: input.recommendedMenuItemId } },
    });
    if (existing) throw new ConflictError('This item is already recommended alongside the source item.');

    return prisma.$transaction(async (tx) => {
      const recommendation = await tx.menuItemRecommendation.create({
        data: {
          organizationId,
          menuItemId: itemId,
          recommendedMenuItemId: input.recommendedMenuItemId,
          label: input.label,
          bundlePrice: input.bundlePrice,
          displayOrder: input.displayOrder,
        },
      });
      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: 'menu_item_recommendation.create',
        entityType: 'MenuItemRecommendation',
        entityId: recommendation.id,
        newValue: recommendation,
      });
      return recommendation;
    });
  }

  static async removeRecommendation(organizationId: string, itemId: string, recommendationId: string, actorUserId: string) {
    const existing = await prisma.menuItemRecommendation.findFirst({
      where: { id: recommendationId, organizationId, menuItemId: itemId },
    });
    if (!existing) throw new NotFoundError('Recommendation');

    await prisma.$transaction(async (tx) => {
      await tx.menuItemRecommendation.delete({ where: { id: recommendationId } });
      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: 'menu_item_recommendation.delete',
        entityType: 'MenuItemRecommendation',
        entityId: recommendationId,
        previousValue: existing,
      });
    });
    return { success: true as const };
  }
}
