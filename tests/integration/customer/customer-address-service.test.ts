import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { CustomerAddressService } from '@/services/customer/CustomerAddressService';
import { resetDatabase } from '../../helpers/db';
import { NotFoundError } from '@/lib/utils/api-error';

/**
 * CAPP Phase 5 — CustomerAddressService (spec § 1 item 23, "Save
 * addresses"). Mirrors the setup shape of customer-order-service.test.ts /
 * customer-reservation-service.test.ts.
 */
async function setupOrg(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Customer Address Test ${suffix}`,
    organizationEmail: `customer-address-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@customer-address-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  const orgRow = await prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
  return { user, publicCode: orgRow.publicCode! };
}

async function registerDiner(suffix: string) {
  const result = await CustomerAccountService.register(
    {
      email: `diner-address-${suffix}@example.com`,
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

describe('CustomerAddressService', () => {
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

  it('list returns an empty array (not an error, and creates no Customer row) for a diner with no profile at this restaurant yet', async () => {
    const { publicCode } = await setupOrg('list-1');
    const customerAccountId = await registerDiner('list-1');

    const addresses = await CustomerAddressService.list(publicCode, customerAccountId);
    expect(addresses).toEqual([]);
    const customer = await prisma.customer.findFirst({ where: { customerAccountId } });
    expect(customer).toBeNull();
  });

  it('creates an address, lazily creating the Customer CRM profile', async () => {
    const { user, publicCode } = await setupOrg('create-1');
    const customerAccountId = await registerDiner('create-1');

    const address = await CustomerAddressService.create(publicCode, customerAccountId, {
      label: 'Home',
      line1: '123 Rizal St',
      city: 'Manila',
      country: 'PH',
      isDefault: true,
    });

    expect(address.label).toBe('Home');
    expect(address.isDefault).toBe(true);
    const customer = await prisma.customer.findFirst({ where: { organizationId: user.organizationId, customerAccountId } });
    expect(customer).not.toBeNull();
    expect(address.customerId).toBe(customer!.id);
  });

  it('setting a second address as default clears the first one\'s default flag', async () => {
    const { publicCode } = await setupOrg('default-1');
    const customerAccountId = await registerDiner('default-1');

    const first = await CustomerAddressService.create(publicCode, customerAccountId, {
      label: 'Home',
      line1: '1 First St',
      isDefault: true,
    });
    const second = await CustomerAddressService.create(publicCode, customerAccountId, {
      label: 'Office',
      line1: '2 Second St',
      isDefault: true,
    });

    const addresses = await CustomerAddressService.list(publicCode, customerAccountId);
    const refreshedFirst = addresses.find((a) => a.id === first.id)!;
    const refreshedSecond = addresses.find((a) => a.id === second.id)!;
    expect(refreshedFirst.isDefault).toBe(false);
    expect(refreshedSecond.isDefault).toBe(true);
  });

  it('update only affects the requesting diner\'s own address', async () => {
    const { publicCode } = await setupOrg('update-1');
    const dinerA = await registerDiner('update-1-a');
    const dinerB = await registerDiner('update-1-b');

    const address = await CustomerAddressService.create(publicCode, dinerA, { line1: 'Original line' });

    const updated = await CustomerAddressService.update(publicCode, dinerA, address.id, { line1: 'Updated line' });
    expect(updated.line1).toBe('Updated line');

    await expect(
      CustomerAddressService.update(publicCode, dinerB, address.id, { line1: 'Hijacked' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('remove only affects the requesting diner\'s own address', async () => {
    const { publicCode } = await setupOrg('remove-1');
    const dinerA = await registerDiner('remove-1-a');
    const dinerB = await registerDiner('remove-1-b');

    const address = await CustomerAddressService.create(publicCode, dinerA, { line1: 'To be removed' });

    await expect(CustomerAddressService.remove(publicCode, dinerB, address.id)).rejects.toThrow(NotFoundError);

    await CustomerAddressService.remove(publicCode, dinerA, address.id);
    const remaining = await prisma.customerAddress.findUnique({ where: { id: address.id } });
    expect(remaining).toBeNull();
  });
});
