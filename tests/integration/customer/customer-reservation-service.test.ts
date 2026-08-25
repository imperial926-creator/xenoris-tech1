import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { TableService } from '@/services/tables/TableService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { CustomerReservationService } from '@/services/customer/CustomerReservationService';
import { resetDatabase } from '../../helpers/db';
import { ConflictError } from '@/lib/utils/api-error';

async function setupOrgWithBranch(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Customer Reservation Test ${suffix}`,
    organizationEmail: `customer-reservation-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@customer-reservation-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  const branch = await BranchService.create(
    user.organizationId,
    { name: `Branch ${suffix}`, timezone: 'Asia/Manila' },
    user.id,
  );
  const orgRow = await prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
  return { user, branch, publicCode: orgRow.publicCode! };
}

async function registerDiner(suffix: string) {
  const result = await CustomerAccountService.register(
    {
      email: `diner-${suffix}@example.com`,
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

describe('CustomerReservationService', () => {
  beforeAll(() => {
    process.env.CUSTOMER_AUTH_SECRET =
      'test-customer-secret-do-not-use-in-production-cccccccccccccccccccccccccccccccc';
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('checkAvailability reports no availability before any table exists', async () => {
    const { publicCode } = await setupOrgWithBranch('avail-1');
    const result = await CustomerReservationService.checkAvailability(publicCode, {
      startAt: hoursFromNow(24),
      durationMinutes: 90,
      guestCount: 2,
    });
    expect(result).toEqual({ available: false, seatingOptions: [] });
  });

  it('auto-assigns the smallest sufficient table and links the diner to a Customer CRM row', async () => {
    const { user, branch, publicCode } = await setupOrgWithBranch('create-1');
    await TableService.createTable(user.organizationId, branch.id, { tableNumber: 'T1', capacity: 2 }, user.id);
    await TableService.createTable(user.organizationId, branch.id, { tableNumber: 'T2', capacity: 6 }, user.id);
    const customerAccountId = await registerDiner('create-1');

    const reservation = await CustomerReservationService.createReservation(publicCode, customerAccountId, {
      startAt: hoursFromNow(24),
      durationMinutes: 90,
      guestCount: 2,
    });

    expect(reservation.status).toBe('PENDING');
    expect(reservation.tables).toHaveLength(1);
    expect(reservation.tables[0].table.tableNumber).toBe('T1'); // Smallest sufficient table, not the 6-top.
    expect(reservation.guestName).toBe('Dina Diner');
    expect(reservation.seatingPreferenceHonored).toBe(false); // No preference was requested.

    const customer = await prisma.customer.findFirst({ where: { organizationId: user.organizationId } });
    expect(customer?.customerAccountId).toBe(customerAccountId);
    expect(reservation.customerId).toBe(customer!.id);
  });

  it('honors a matching seating preference and reports it back honestly', async () => {
    const { user, branch, publicCode } = await setupOrgWithBranch('create-2');
    const section = await prisma.tableSection.create({
      data: { organizationId: user.organizationId, branchId: branch.id, name: 'Outdoor Patio' },
    });
    await TableService.createTable(user.organizationId, branch.id, { tableNumber: 'IN1', capacity: 4 }, user.id);
    await prisma.restaurantTable.create({
      data: { organizationId: user.organizationId, branchId: branch.id, tableNumber: 'OUT1', capacity: 4, sectionId: section.id },
    });
    const customerAccountId = await registerDiner('create-2');

    const reservation = await CustomerReservationService.createReservation(publicCode, customerAccountId, {
      startAt: hoursFromNow(24),
      durationMinutes: 90,
      guestCount: 2,
      seatingPreference: 'outdoor',
    });

    expect(reservation.tables[0].table.tableNumber).toBe('OUT1');
    expect(reservation.seatingPreferenceHonored).toBe(true);
  });

  it('throws ConflictError when no table (single or combined) can seat the party', async () => {
    const { user, branch, publicCode } = await setupOrgWithBranch('create-3');
    await TableService.createTable(user.organizationId, branch.id, { tableNumber: 'T1', capacity: 2 }, user.id);
    const customerAccountId = await registerDiner('create-3');

    await expect(
      CustomerReservationService.createReservation(publicCode, customerAccountId, {
        startAt: hoursFromNow(24),
        durationMinutes: 90,
        guestCount: 20,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('list returns an empty array (not an error) for a diner who has never booked here', async () => {
    const { publicCode } = await setupOrgWithBranch('list-1');
    const customerAccountId = await registerDiner('list-1');
    const reservations = await CustomerReservationService.list(publicCode, customerAccountId, {
      take: 50,
      skip: 0,
    });
    expect(reservations).toEqual([]);
    // Confirms the read path never lazily creates a Customer row as a side effect.
    const customer = await prisma.customer.findFirst({ where: { customerAccountId } });
    expect(customer).toBeNull();
  });

  it('list and get only return the requesting diner\'s own reservations', async () => {
    const { user, branch, publicCode } = await setupOrgWithBranch('list-2');
    await TableService.createTable(user.organizationId, branch.id, { tableNumber: 'T1', capacity: 4 }, user.id);
    const dinerA = await registerDiner('list-2-a');
    const dinerB = await registerDiner('list-2-b');

    const booked = await CustomerReservationService.createReservation(publicCode, dinerA, {
      startAt: hoursFromNow(24),
      durationMinutes: 90,
      guestCount: 2,
    });

    const dinerAList = await CustomerReservationService.list(publicCode, dinerA, { take: 50, skip: 0 });
    expect(dinerAList).toHaveLength(1);
    const dinerBList = await CustomerReservationService.list(publicCode, dinerB, { take: 50, skip: 0 });
    expect(dinerBList).toHaveLength(0);

    await expect(CustomerReservationService.get(publicCode, dinerB, booked.id)).rejects.toThrow();
    const fetched = await CustomerReservationService.get(publicCode, dinerA, booked.id);
    expect(fetched.id).toBe(booked.id);
  });
});
