import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { MenuService } from '@/services/menu/MenuService';
import { OrderService } from '@/services/orders/OrderService';
import { KitchenService } from '@/services/kitchen/KitchenService';
import { resetDatabase } from '../../helpers/db';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';

async function setupFixture(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Kitchen Test ${suffix}`,
    organizationEmail: `kitchen-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@kitchen-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  const branch = await BranchService.create(user.organizationId, { name: `Branch ${suffix}`, timezone: 'Asia/Manila' }, user.id);
  const category = await MenuService.createCategory(user.organizationId, { name: 'Mains', displayOrder: 0 }, user.id);
  const item = await MenuService.createItem(
    user.organizationId,
    { categoryId: category.id, name: 'Burger', price: '150.00', available: true, taxCategory: 'STANDARD' },
    user.id,
  );
  return { user, branch, item };
}

async function createOrder(user: { organizationId: string; id: string }, branch: { id: string }, item: { id: string }) {
  return OrderService.createOrder(
    user.organizationId,
    branch.id,
    { type: 'TAKEOUT', discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] },
    user.id,
  );
}

describe('KitchenService', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns only active tickets (PENDING/CONFIRMED/PREPARING/READY), oldest first', async () => {
    const { user, branch, item } = await setupFixture('a');

    const pending = await createOrder(user, branch, item);
    const toConfirmed = await createOrder(user, branch, item);
    await OrderService.updateStatus(user.organizationId, branch.id, toConfirmed.id, { status: 'CONFIRMED' }, user.id);
    const toPreparing = await createOrder(user, branch, item);
    await OrderService.updateStatus(user.organizationId, branch.id, toPreparing.id, { status: 'CONFIRMED' }, user.id);
    await OrderService.updateStatus(user.organizationId, branch.id, toPreparing.id, { status: 'PREPARING' }, user.id);
    const toReady = await createOrder(user, branch, item);
    for (const status of ['CONFIRMED', 'PREPARING', 'READY'] as const) {
      await OrderService.updateStatus(user.organizationId, branch.id, toReady.id, { status }, user.id);
    }
    const toCompleted = await createOrder(user, branch, item);
    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'] as const) {
      await OrderService.updateStatus(user.organizationId, branch.id, toCompleted.id, { status }, user.id);
    }
    const toCancelled = await createOrder(user, branch, item);
    await OrderService.updateStatus(
      user.organizationId, branch.id, toCancelled.id, { status: 'CANCELLED', cancellationReason: 'test' }, user.id,
    );

    const queue = await KitchenService.getQueue(user.organizationId, branch.id);

    const queueIds = queue.map((o: (typeof queue)[number]) => o.id);
    expect(queueIds).toContain(pending.id);
    expect(queueIds).toContain(toConfirmed.id);
    expect(queueIds).toContain(toPreparing.id);
    expect(queueIds).toContain(toReady.id);
    expect(queueIds).not.toContain(toCompleted.id);
    expect(queueIds).not.toContain(toCancelled.id);
    expect(queue).toHaveLength(4);

    // Oldest first: createdAt must be non-decreasing across the returned list.
    for (let i = 1; i < queue.length; i += 1) {
      expect(queue[i].createdAt.getTime()).toBeGreaterThanOrEqual(queue[i - 1].createdAt.getTime());
    }
  });

  it('does not include another organization\'s orders in the queue', async () => {
    const orgA = await setupFixture('b');
    const orgB = await setupFixture('c');
    await createOrder(orgA.user, orgA.branch, orgA.item);

    const queue = await KitchenService.getQueue(orgB.user.organizationId, orgB.branch.id);
    expect(queue).toHaveLength(0);
  });

  it('advances PENDING -> CONFIRMED -> PREPARING -> READY one step at a time', async () => {
    const { user, branch, item } = await setupFixture('d');
    const order = await createOrder(user, branch, item);
    expect(order.status).toBe('PENDING');

    const afterAccept = await KitchenService.advanceStatus(user.organizationId, branch.id, order.id, user.id);
    expect(afterAccept.status).toBe('CONFIRMED');

    const afterPreparing = await KitchenService.advanceStatus(user.organizationId, branch.id, order.id, user.id);
    expect(afterPreparing.status).toBe('PREPARING');

    const afterReady = await KitchenService.advanceStatus(user.organizationId, branch.id, order.id, user.id);
    expect(afterReady.status).toBe('READY');
  });

  it('rejects advancing an order already at READY (kitchen workflow ends there)', async () => {
    const { user, branch, item } = await setupFixture('e');
    const order = await createOrder(user, branch, item);
    for (const status of ['CONFIRMED', 'PREPARING', 'READY'] as const) {
      await OrderService.updateStatus(user.organizationId, branch.id, order.id, { status }, user.id);
    }
    await expect(
      KitchenService.advanceStatus(user.organizationId, branch.id, order.id, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects advancing a CANCELLED order', async () => {
    const { user, branch, item } = await setupFixture('f');
    const order = await createOrder(user, branch, item);
    await OrderService.updateStatus(
      user.organizationId, branch.id, order.id, { status: 'CANCELLED', cancellationReason: 'out of stock' }, user.id,
    );
    await expect(
      KitchenService.advanceStatus(user.organizationId, branch.id, order.id, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('does not allow advancing an order belonging to another organization', async () => {
    const orgA = await setupFixture('g');
    const orgB = await setupFixture('h');
    const order = await createOrder(orgA.user, orgA.branch, orgA.item);

    await expect(
      KitchenService.advanceStatus(orgB.user.organizationId, orgB.branch.id, order.id, orgB.user.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('surfaces requiredAt on queued tickets when set at order creation', async () => {
    const { user, branch, item } = await setupFixture('i');
    const requiredAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const order = await OrderService.createOrder(
      user.organizationId,
      branch.id,
      { type: 'DELIVERY', deliveryAddress: '1 Test St', discountAmount: '0.00', requiredAt, items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] },
      user.id,
    );
    expect(order.requiredAt?.toISOString()).toBe(requiredAt);

    const queue = await KitchenService.getQueue(user.organizationId, branch.id);
    expect(queue.find((o: (typeof queue)[number]) => o.id === order.id)?.requiredAt?.toISOString()).toBe(requiredAt);
  });

  it('rejects an unparseable requiredAt at order creation', async () => {
    const { user, branch, item } = await setupFixture('j');
    await expect(
      OrderService.createOrder(
        user.organizationId,
        branch.id,
        { type: 'TAKEOUT', discountAmount: '0.00', requiredAt: 'not-a-date', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] },
        user.id,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
