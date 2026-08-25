import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { MenuService } from '@/services/menu/MenuService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { CustomerOrderService } from '@/services/customer/CustomerOrderService';
import { CustomerAddressService } from '@/services/customer/CustomerAddressService';
import { DeliveryZoneService } from '@/services/delivery/DeliveryZoneService';
import { resetDatabase } from '../../helpers/db';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';

async function setupOrgWithMenu(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Customer Order Test ${suffix}`,
    organizationEmail: `customer-order-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@customer-order-test-${suffix}.local`,
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
  const orgRow = await prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
  return { user, branch, item, publicCode: orgRow.publicCode! };
}

async function registerDiner(suffix: string) {
  const result = await CustomerAccountService.register(
    {
      email: `diner-order-${suffix}@example.com`,
      password: 'SuperSecret123!',
      firstName: 'Dina',
      lastName: 'Diner',
      marketingOptIn: false,
      acceptedTerms: true,
      acceptedPrivacy: true,
    },
    {},
  );
  return result.customer.id;
}

function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

describe('CustomerOrderService', () => {
  beforeAll(() => {
    process.env.CUSTOMER_AUTH_SECRET =
      'test-customer-secret-do-not-use-in-production-dddddddddddddddddddddddddddddddd';
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('places a TAKEOUT order with server-computed pricing and a PENDING payment record', async () => {
    const { user, item, publicCode } = await setupOrgWithMenu('create-1');
    const customerAccountId = await registerDiner('create-1');

    const order = await CustomerOrderService.createOrder(publicCode, customerAccountId, {
      type: 'TAKEOUT',
      items: [{ menuItemId: item.id, quantity: 2, modifierIds: [] }],
      pickupTime: hoursFromNow(2),
      paymentMethod: 'GCASH',
    });

    expect(order.type).toBe('TAKEOUT');
    expect(order.status).toBe('PENDING');
    expect(order.subtotal.toString()).toBe('300.00'); // 2 x 150.00
    expect(order.guestName).toBe('Dina Diner');
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0].method).toBe('GCASH');
    expect(order.payments[0].status).toBe('PENDING'); // Never COMPLETED — nothing has been verified.

    const customer = await prisma.customer.findFirst({ where: { organizationId: user.organizationId } });
    expect(customer?.customerAccountId).toBe(customerAccountId);
    expect(order.customerId).toBe(customer!.id);
  });

  it('rejects a pickup time in the past', async () => {
    const { item, publicCode } = await setupOrgWithMenu('create-2');
    const customerAccountId = await registerDiner('create-2');

    await expect(
      CustomerOrderService.createOrder(publicCode, customerAccountId, {
        type: 'TAKEOUT',
        items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
        pickupTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        paymentMethod: 'CASH',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('rejects a pickup time outside the branch\'s configured business hours', async () => {
    const { branch, item, publicCode } = await setupOrgWithMenu('create-3');
    await prisma.branch.update({
      where: { id: branch.id },
      data: {
        openingHours: {
          mon: { open: '09:00', close: '17:00' },
          tue: { open: '09:00', close: '17:00' },
          wed: { open: '09:00', close: '17:00' },
          thu: { open: '09:00', close: '17:00' },
          fri: { open: '09:00', close: '17:00' },
          sat: { closed: true },
          sun: { closed: true },
        },
      },
    });
    const customerAccountId = await registerDiner('create-3');

    // Find the next upcoming Saturday (always closed per the hours above).
    const saturday = new Date();
    saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7 || 7));
    saturday.setHours(12, 0, 0, 0);

    await expect(
      CustomerOrderService.createOrder(publicCode, customerAccountId, {
        type: 'TAKEOUT',
        items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
        pickupTime: saturday.toISOString(),
        paymentMethod: 'CASH',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('list returns an empty array (not an error) for a diner who has never ordered here', async () => {
    const { publicCode } = await setupOrgWithMenu('list-1');
    const customerAccountId = await registerDiner('list-1');
    const orders = await CustomerOrderService.list(publicCode, customerAccountId, { take: 50, skip: 0 });
    expect(orders).toEqual([]);
    const customer = await prisma.customer.findFirst({ where: { customerAccountId } });
    expect(customer).toBeNull();
  });

  it('list and get only return the requesting diner\'s own orders', async () => {
    const { item, publicCode } = await setupOrgWithMenu('list-2');
    const dinerA = await registerDiner('list-2-a');
    const dinerB = await registerDiner('list-2-b');

    const placed = await CustomerOrderService.createOrder(publicCode, dinerA, {
      type: 'TAKEOUT',
      items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
      pickupTime: hoursFromNow(2),
      paymentMethod: 'CASH',
    });

    const dinerAOrders = await CustomerOrderService.list(publicCode, dinerA, { take: 50, skip: 0 });
    expect(dinerAOrders).toHaveLength(1);
    const dinerBOrders = await CustomerOrderService.list(publicCode, dinerB, { take: 50, skip: 0 });
    expect(dinerBOrders).toHaveLength(0);

    await expect(CustomerOrderService.get(publicCode, dinerB, placed.id)).rejects.toThrow();
    const fetched = await CustomerOrderService.get(publicCode, dinerA, placed.id);
    expect(fetched.id).toBe(placed.id);
  });

  // --- CAPP Phase 5: DELIVERY ---------------------------------------------

  it('places a DELIVERY order against a saved address, snapshotting the zone fee and creating a companion DeliveryOrder', async () => {
    const { user, branch, item, publicCode } = await setupOrgWithMenu('delivery-1');
    const zone = await DeliveryZoneService.create(
      user.organizationId,
      branch.id,
      { name: 'Downtown', deliveryFee: '75.00' },
      user.id,
    );
    const customerAccountId = await registerDiner('delivery-1');
    const address = await CustomerAddressService.create(publicCode, customerAccountId, {
      label: 'Home',
      line1: '123 Rizal St',
      city: 'Manila',
      country: 'PH',
      isDefault: true,
    });

    const order = await CustomerOrderService.createOrder(publicCode, customerAccountId, {
      type: 'DELIVERY',
      items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
      deliveryZoneId: zone.id,
      deliveryAddressId: address.id,
      paymentMethod: 'CASH',
    });

    expect(order.type).toBe('DELIVERY');
    expect(order.deliveryFee.toString()).toBe('75.00');
    expect(order.deliveryAddress).toContain('Home');
    expect(order.deliveryAddress).toContain('123 Rizal St');
    expect(order.payments[0].status).toBe('PENDING');

    const deliveryOrder = await prisma.deliveryOrder.findUnique({ where: { orderId: order.id } });
    expect(deliveryOrder).not.toBeNull();
    expect(deliveryOrder!.status).toBe('UNASSIGNED');
    expect(deliveryOrder!.deliveryZoneId).toBe(zone.id);
  });

  it('places a DELIVERY order with a freeform address when no saved address is used', async () => {
    const { user, branch, item, publicCode } = await setupOrgWithMenu('delivery-2');
    const zone = await DeliveryZoneService.create(
      user.organizationId,
      branch.id,
      { name: 'Suburbs', deliveryFee: '50.00' },
      user.id,
    );
    const customerAccountId = await registerDiner('delivery-2');

    const order = await CustomerOrderService.createOrder(publicCode, customerAccountId, {
      type: 'DELIVERY',
      items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
      deliveryZoneId: zone.id,
      deliveryAddress: '456 Freeform Ave, Quezon City',
      paymentMethod: 'CASH',
    });

    expect(order.deliveryAddress).toBe('456 Freeform Ave, Quezon City');
  });

  it('rejects a DELIVERY order against another diner\'s saved address', async () => {
    const { user, branch, item, publicCode } = await setupOrgWithMenu('delivery-3');
    const zone = await DeliveryZoneService.create(
      user.organizationId,
      branch.id,
      { name: 'Downtown', deliveryFee: '75.00' },
      user.id,
    );
    const dinerA = await registerDiner('delivery-3-a');
    const dinerB = await registerDiner('delivery-3-b');
    const addressA = await CustomerAddressService.create(publicCode, dinerA, {
      line1: 'Diner A only',
      isDefault: false,
    });

    await expect(
      CustomerOrderService.createOrder(publicCode, dinerB, {
        type: 'DELIVERY',
        items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
        deliveryZoneId: zone.id,
        deliveryAddressId: addressA.id,
        paymentMethod: 'CASH',
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects a DELIVERY order against an inactive delivery zone', async () => {
    const { user, branch, item, publicCode } = await setupOrgWithMenu('delivery-4');
    const zone = await DeliveryZoneService.create(
      user.organizationId,
      branch.id,
      { name: 'Retired Zone', deliveryFee: '30.00' },
      user.id,
    );
    await DeliveryZoneService.update(user.organizationId, branch.id, zone.id, { active: false }, user.id);
    const customerAccountId = await registerDiner('delivery-4');

    await expect(
      CustomerOrderService.createOrder(publicCode, customerAccountId, {
        type: 'DELIVERY',
        items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
        deliveryZoneId: zone.id,
        deliveryAddress: '789 Somewhere St',
        paymentMethod: 'CASH',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('getDeliveryStatusHistory returns the delivery timeline scoped to the requesting diner, and 404s for a take-out order', async () => {
    const { user, branch, item, publicCode } = await setupOrgWithMenu('delivery-5');
    const zone = await DeliveryZoneService.create(
      user.organizationId,
      branch.id,
      { name: 'Downtown', deliveryFee: '75.00' },
      user.id,
    );
    const dinerA = await registerDiner('delivery-5-a');
    const dinerB = await registerDiner('delivery-5-b');

    const deliveryOrder = await CustomerOrderService.createOrder(publicCode, dinerA, {
      type: 'DELIVERY',
      items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
      deliveryZoneId: zone.id,
      deliveryAddress: '1 Delivery Way',
      paymentMethod: 'CASH',
    });
    const takeoutOrder = await CustomerOrderService.createOrder(publicCode, dinerA, {
      type: 'TAKEOUT',
      items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
      pickupTime: hoursFromNow(2),
      paymentMethod: 'CASH',
    });

    const history = await CustomerOrderService.getDeliveryStatusHistory(publicCode, dinerA, deliveryOrder.id);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].toStatus).toBe('UNASSIGNED');

    await expect(
      CustomerOrderService.getDeliveryStatusHistory(publicCode, dinerA, takeoutOrder.id),
    ).rejects.toThrow(NotFoundError);
    await expect(
      CustomerOrderService.getDeliveryStatusHistory(publicCode, dinerB, deliveryOrder.id),
    ).rejects.toThrow();
  });

  it('list filters by type, and with no filter returns both TAKEOUT and DELIVERY but never DINE_IN', async () => {
    const { user, branch, item, publicCode } = await setupOrgWithMenu('list-3');
    const zone = await DeliveryZoneService.create(
      user.organizationId,
      branch.id,
      { name: 'Downtown', deliveryFee: '75.00' },
      user.id,
    );
    const customerAccountId = await registerDiner('list-3');

    await CustomerOrderService.createOrder(publicCode, customerAccountId, {
      type: 'TAKEOUT',
      items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
      pickupTime: hoursFromNow(2),
      paymentMethod: 'CASH',
    });
    await CustomerOrderService.createOrder(publicCode, customerAccountId, {
      type: 'DELIVERY',
      items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
      deliveryZoneId: zone.id,
      deliveryAddress: '1 Delivery Way',
      paymentMethod: 'CASH',
    });

    const all = await CustomerOrderService.list(publicCode, customerAccountId, { take: 50, skip: 0 });
    expect(all).toHaveLength(2);

    const takeoutOnly = await CustomerOrderService.list(publicCode, customerAccountId, {
      type: 'TAKEOUT',
      take: 50,
      skip: 0,
    });
    expect(takeoutOnly).toHaveLength(1);
    expect(takeoutOnly[0].type).toBe('TAKEOUT');

    const deliveryOnly = await CustomerOrderService.list(publicCode, customerAccountId, {
      type: 'DELIVERY',
      take: 50,
      skip: 0,
    });
    expect(deliveryOnly).toHaveLength(1);
    expect(deliveryOnly[0].type).toBe('DELIVERY');
  });
});
