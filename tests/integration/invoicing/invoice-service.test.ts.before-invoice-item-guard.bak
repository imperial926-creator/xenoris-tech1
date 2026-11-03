import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { MenuService } from '@/services/menu/MenuService';
import { OrderService } from '@/services/orders/OrderService';
import { InvoiceService } from '@/services/invoicing/InvoiceService';
import { resetDatabase } from '../../helpers/db';
import { ConflictError } from '@/lib/utils/api-error';

async function setupFixture(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Invoice Test ${suffix}`,
    organizationEmail: `invoice-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@invoice-test-${suffix}.local`,
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

async function createPaidOrder(user: { organizationId: string; id: string }, branch: { id: string }, item: { id: string }) {
  const order = await OrderService.createOrder(
    user.organizationId,
    branch.id,
    { type: 'TAKEOUT', discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] },
    user.id,
  );
  // total = 150.00 + 12% VAT = 168.00
  return OrderService.recordPayment(
    user.organizationId, branch.id, order.id, { method: 'CASH', amount: '168.00', status: 'COMPLETED' }, user.id,
  );
}

describe('InvoiceService', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects issuing an invoice for an order that is not fully paid', async () => {
    const { user, branch, item } = await setupFixture('a');
    const order = await OrderService.createOrder(
      user.organizationId, branch.id,
      { type: 'TAKEOUT', discountAmount: '0.00', items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }] },
      user.id,
    );
    await expect(
      InvoiceService.issueInvoice(user.organizationId, branch.id, order.id, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('issues an invoice with a sequential number and matching line items', async () => {
    const { user, branch, item } = await setupFixture('b');
    const order = await createPaidOrder(user, branch, item);

    const invoice = await InvoiceService.issueInvoice(user.organizationId, branch.id, order.id, user.id);
    expect(invoice.invoiceNumber).toBe('INV-000001');
    expect(invoice.status).toBe('ISSUED');
    expect(invoice.total.toString()).toBe('168.00');
    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0].nameSnapshot).toBe('Burger');
  });

  it('numbers sequentially across multiple orders in the same branch', async () => {
    const { user, branch, item } = await setupFixture('c');
    const order1 = await createPaidOrder(user, branch, item);
    const order2 = await createPaidOrder(user, branch, item);

    const invoice1 = await InvoiceService.issueInvoice(user.organizationId, branch.id, order1.id, user.id);
    const invoice2 = await InvoiceService.issueInvoice(user.organizationId, branch.id, order2.id, user.id);
    expect(invoice1.invoiceNumber).toBe('INV-000001');
    expect(invoice2.invoiceNumber).toBe('INV-000002');
  });

  it('rejects a second active invoice for the same order', async () => {
    const { user, branch, item } = await setupFixture('d');
    const order = await createPaidOrder(user, branch, item);
    await InvoiceService.issueInvoice(user.organizationId, branch.id, order.id, user.id);

    await expect(
      InvoiceService.issueInvoice(user.organizationId, branch.id, order.id, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows reissuing after voiding the original invoice', async () => {
    const { user, branch, item } = await setupFixture('e');
    const order = await createPaidOrder(user, branch, item);
    const first = await InvoiceService.issueInvoice(user.organizationId, branch.id, order.id, user.id);
    await InvoiceService.voidInvoice(user.organizationId, branch.id, first.id, { reason: 'Test void' }, user.id);

    const reissued = await InvoiceService.issueInvoice(user.organizationId, branch.id, order.id, user.id);
    expect(reissued.invoiceNumber).toBe('INV-000002');
    expect(reissued.status).toBe('ISSUED');
  });

  /**
   * The real proof of "no duplicate invoice numbers under a race": create
   * several fully-paid orders on the same branch, then issue invoices for
   * ALL of them genuinely concurrently (Promise.allSettled, not
   * sequentially). Every issuance targets a different order, so none of
   * them should hit the "one active invoice per order" rule — the only
   * thing that could go wrong is the atomic per-branch counter, and this
   * proves it doesn't. Same rigor as Phase 3's double-booking concurrency
   * test, applied to "safely assign the next number" instead of "safely
   * reject an overlap."
   */
  it('assigns unique sequential numbers under genuine concurrent issuance', async () => {
    const { user, branch, item } = await setupFixture('f');
    const orders = await Promise.all(
      Array.from({ length: 5 }, () => createPaidOrder(user, branch, item)),
    );

    const results = await Promise.allSettled(
      orders.map((order) => InvoiceService.issueInvoice(user.organizationId, branch.id, order.id, user.id)),
    );
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof InvoiceService.issueInvoice>>> => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(5);

    const numbers = fulfilled.map((r) => r.value.invoiceNumber);
    expect(new Set(numbers).size).toBe(5); // all unique, no duplicates
    expect(numbers.sort()).toEqual(['INV-000001', 'INV-000002', 'INV-000003', 'INV-000004', 'INV-000005']);
  });
});
