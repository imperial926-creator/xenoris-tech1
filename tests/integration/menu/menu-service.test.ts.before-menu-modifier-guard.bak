import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { MenuService } from '@/services/menu/MenuService';
import { resetDatabase } from '../../helpers/db';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';

async function setupOrg(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Menu Test ${suffix}`,
    organizationEmail: `menu-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@menu-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  return user;
}

describe('MenuService', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a category and an item under it', async () => {
    const user = await setupOrg('a');
    const category = await MenuService.createCategory(user.organizationId, { name: 'Mains', displayOrder: 0 }, user.id);
    const item = await MenuService.createItem(
      user.organizationId,
      { categoryId: category.id, name: 'Chicken Rice', price: '199.00', available: true, taxCategory: 'STANDARD' },
      user.id,
    );
    expect(item.categoryId).toBe(category.id);
    expect(item.price.toString()).toBe('199.00');
  });

  it('rejects a duplicate category name within the same organization', async () => {
    const user = await setupOrg('b');
    await MenuService.createCategory(user.organizationId, { name: 'Mains', displayOrder: 0 }, user.id);
    await expect(
      MenuService.createCategory(user.organizationId, { name: 'Mains', displayOrder: 0 }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects creating an item under a category from another organization', async () => {
    const userA = await setupOrg('c');
    const userB = await setupOrg('d');
    const categoryA = await MenuService.createCategory(userA.organizationId, { name: 'Mains', displayOrder: 0 }, userA.id);

    await expect(
      MenuService.createItem(
        userB.organizationId,
        { categoryId: categoryA.id, name: 'Stolen Item', price: '100.00', available: true, taxCategory: 'STANDARD' },
        userB.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('adds a variant with an independent price', async () => {
    const user = await setupOrg('e');
    const category = await MenuService.createCategory(user.organizationId, { name: 'Mains', displayOrder: 0 }, user.id);
    const item = await MenuService.createItem(
      user.organizationId,
      { categoryId: category.id, name: 'Chicken Rice', price: '199.00', available: true, taxCategory: 'STANDARD' },
      user.id,
    );
    const variant = await MenuService.addVariant(
      user.organizationId,
      item.id,
      { name: 'Large', price: '249.00', displayOrder: 0 },
      user.id,
    );
    expect(variant.price.toString()).toBe('249.00');
  });

  it('builds a modifier group with a SINGLE selection type and links it to an item', async () => {
    const user = await setupOrg('f');
    const category = await MenuService.createCategory(user.organizationId, { name: 'Mains', displayOrder: 0 }, user.id);
    const item = await MenuService.createItem(
      user.organizationId,
      { categoryId: category.id, name: 'Chicken Rice', price: '199.00', available: true, taxCategory: 'STANDARD' },
      user.id,
    );
    const group = await MenuService.createModifierGroup(
      user.organizationId,
      { name: 'Size', selectionType: 'SINGLE', required: true, minSelect: 1, maxSelect: 1 },
      user.id,
    );
    await MenuService.addModifier(user.organizationId, group.id, { name: 'Large', priceDelta: '30.00', displayOrder: 0 }, user.id);
    await MenuService.linkModifierGroupToItem(user.organizationId, item.id, group.id, user.id);

    const fullItem = await MenuService.getItem(user.organizationId, item.id);
    expect(fullItem.modifierGroups).toHaveLength(1);
    expect(fullItem.modifierGroups[0].modifierGroup.modifiers[0].name).toBe('Large');
  });

  it('rejects linking the same modifier group to an item twice', async () => {
    const user = await setupOrg('g');
    const category = await MenuService.createCategory(user.organizationId, { name: 'Mains', displayOrder: 0 }, user.id);
    const item = await MenuService.createItem(
      user.organizationId,
      { categoryId: category.id, name: 'Chicken Rice', price: '199.00', available: true, taxCategory: 'STANDARD' },
      user.id,
    );
    const group = await MenuService.createModifierGroup(
      user.organizationId,
      { name: 'Size', selectionType: 'SINGLE', required: true, minSelect: 1, maxSelect: 1 },
      user.id,
    );
    await MenuService.linkModifierGroupToItem(user.organizationId, item.id, group.id, user.id);
    await expect(
      MenuService.linkModifierGroupToItem(user.organizationId, item.id, group.id, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('does not leak menu items across organizations', async () => {
    const userA = await setupOrg('h');
    const userB = await setupOrg('i');
    const categoryA = await MenuService.createCategory(userA.organizationId, { name: 'Mains', displayOrder: 0 }, userA.id);
    await MenuService.createItem(
      userA.organizationId,
      { categoryId: categoryA.id, name: 'A Item', price: '100.00', available: true, taxCategory: 'STANDARD' },
      userA.id,
    );

    const itemsForB = await MenuService.listItems(userB.organizationId);
    expect(itemsForB).toHaveLength(0);
  });
});
