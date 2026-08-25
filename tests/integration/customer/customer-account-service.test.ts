import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { AuthService } from '@/services/auth/AuthService';
import { resetDatabase } from '../../helpers/db';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';
import { CustomerUnauthenticatedError } from '@/lib/customer-auth/guard';

const baseRegisterInput = {
  email: 'diner@example.com',
  password: 'SuperSecret123!',
  firstName: 'Dina',
  lastName: 'Diner',
  marketingOptIn: false,
  acceptedTerms: true as const,
  acceptedPrivacy: true as const,
};

describe('CustomerAccountService', () => {
  beforeAll(() => {
    process.env.CUSTOMER_AUTH_SECRET =
      'test-customer-secret-do-not-use-in-production-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('registers a new CustomerAccount with default notification preferences', async () => {
    const result = await CustomerAccountService.register(baseRegisterInput, {});
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.customer.email).toBe(baseRegisterInput.email);

    const account = await prisma.customerAccount.findUnique({
      where: { email: baseRegisterInput.email },
      include: { notificationPreference: true },
    });
    expect(account).not.toBeNull();
    expect(account!.notificationPreference).not.toBeNull();
    expect(account!.notificationPreference!.allowPromotional).toBe(true);
  });

  it('rejects registering the same email twice', async () => {
    await CustomerAccountService.register(baseRegisterInput, {});
    await expect(CustomerAccountService.register(baseRegisterInput, {})).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('logs in with correct credentials and issues a fresh token pair', async () => {
    await CustomerAccountService.register(baseRegisterInput, {});
    const result = await CustomerAccountService.login(
      { email: baseRegisterInput.email, password: baseRegisterInput.password },
      {},
    );
    expect(result.customer.email).toBe(baseRegisterInput.email);
  });

  it('rejects login with the wrong password', async () => {
    await CustomerAccountService.register(baseRegisterInput, {});
    await expect(
      CustomerAccountService.login(
        { email: baseRegisterInput.email, password: 'totally-wrong' },
        {},
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects login for a nonexistent email', async () => {
    await expect(
      CustomerAccountService.login({ email: 'nobody@example.com', password: 'whatever1' }, {}),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rotates the refresh token on use and revokes the old one', async () => {
    const initial = await CustomerAccountService.register(baseRegisterInput, {});
    const refreshed = await CustomerAccountService.refresh(initial.refreshToken);
    expect(refreshed.refreshToken).not.toEqual(initial.refreshToken);

    // The original refresh token must no longer work (rotation-on-use).
    await expect(CustomerAccountService.refresh(initial.refreshToken)).rejects.toBeInstanceOf(
      CustomerUnauthenticatedError,
    );

    // The newly-issued one does.
    await expect(CustomerAccountService.refresh(refreshed.refreshToken)).resolves.toBeTruthy();
  });

  it('rejects an unknown refresh token', async () => {
    await expect(CustomerAccountService.refresh('not-a-real-token')).rejects.toBeInstanceOf(
      CustomerUnauthenticatedError,
    );
  });

  it('logout revokes only the presented device refresh token', async () => {
    const deviceA = await CustomerAccountService.register(baseRegisterInput, {
      deviceInfo: 'iPhone A',
    });
    const deviceB = await CustomerAccountService.login(
      { email: baseRegisterInput.email, password: baseRegisterInput.password },
      { deviceInfo: 'iPhone B' },
    );

    await CustomerAccountService.logout(deviceA.refreshToken);

    await expect(CustomerAccountService.refresh(deviceA.refreshToken)).rejects.toBeInstanceOf(
      CustomerUnauthenticatedError,
    );
    await expect(CustomerAccountService.refresh(deviceB.refreshToken)).resolves.toBeTruthy();
  });

  it('logout-all revokes every device', async () => {
    const deviceA = await CustomerAccountService.register(baseRegisterInput, {});
    const deviceB = await CustomerAccountService.login(
      { email: baseRegisterInput.email, password: baseRegisterInput.password },
      {},
    );
    const account = await prisma.customerAccount.findUniqueOrThrow({
      where: { email: baseRegisterInput.email },
    });

    await CustomerAccountService.logoutAll(account.id);

    await expect(CustomerAccountService.refresh(deviceA.refreshToken)).rejects.toBeInstanceOf(
      CustomerUnauthenticatedError,
    );
    await expect(CustomerAccountService.refresh(deviceB.refreshToken)).rejects.toBeInstanceOf(
      CustomerUnauthenticatedError,
    );
  });

  it('getOrCreateCustomerProfile creates a new per-org Customer row on first contact', async () => {
    await CustomerAccountService.register(baseRegisterInput, {});
    const account = await prisma.customerAccount.findUniqueOrThrow({
      where: { email: baseRegisterInput.email },
    });
    const org = await AuthService.register({
      organizationName: 'Test Restaurant',
      organizationEmail: 'org@test-restaurant.local',
      firstName: 'Ada',
      lastName: 'Owner',
      email: 'ada@test-restaurant.local',
      password: 'SuperSecret123!',
      currency: 'PHP',
      timezone: 'Asia/Manila',
    });

    const profile = await CustomerAccountService.getOrCreateCustomerProfile(
      org.user.organizationId,
      account.id,
    );
    expect(profile.customerAccountId).toBe(account.id);
    expect(profile.email).toBe(baseRegisterInput.email);

    // Second call is idempotent — same row, not a duplicate.
    const again = await CustomerAccountService.getOrCreateCustomerProfile(
      org.user.organizationId,
      account.id,
    );
    expect(again.id).toBe(profile.id);
  });

  it('getOrCreateCustomerProfile links to a pre-existing staff-entered Customer with the same email', async () => {
    const org = await AuthService.register({
      organizationName: 'Test Restaurant',
      organizationEmail: 'org2@test-restaurant.local',
      firstName: 'Ada',
      lastName: 'Owner',
      email: 'ada2@test-restaurant.local',
      password: 'SuperSecret123!',
      currency: 'PHP',
      timezone: 'Asia/Manila',
    });
    const walkIn = await prisma.customer.create({
      data: {
        organizationId: org.user.organizationId,
        firstName: 'Dina',
        lastName: 'Diner',
        email: baseRegisterInput.email,
      },
    });

    await CustomerAccountService.register(baseRegisterInput, {});
    const account = await prisma.customerAccount.findUniqueOrThrow({
      where: { email: baseRegisterInput.email },
    });

    const profile = await CustomerAccountService.getOrCreateCustomerProfile(
      org.user.organizationId,
      account.id,
    );
    expect(profile.id).toBe(walkIn.id);
    expect(profile.customerAccountId).toBe(account.id);

    const count = await prisma.customer.count({ where: { organizationId: org.user.organizationId } });
    expect(count).toBe(1);
  });
});

describe('RestaurantDirectoryService.allocatePublicCode via AuthService.register', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('assigns sequential RST-###### public codes to new organizations', async () => {
    const first = await AuthService.register({
      organizationName: 'First Restaurant',
      organizationEmail: 'first@test-restaurant.local',
      firstName: 'Ada',
      lastName: 'Owner',
      email: 'ada@first.local',
      password: 'SuperSecret123!',
      currency: 'PHP',
      timezone: 'Asia/Manila',
    });
    const second = await AuthService.register({
      organizationName: 'Second Restaurant',
      organizationEmail: 'second@test-restaurant.local',
      firstName: 'Bea',
      lastName: 'Owner',
      email: 'bea@second.local',
      password: 'SuperSecret123!',
      currency: 'PHP',
      timezone: 'Asia/Manila',
    });

    const firstOrg = await prisma.organization.findUniqueOrThrow({
      where: { id: first.user.organizationId },
    });
    const secondOrg = await prisma.organization.findUniqueOrThrow({
      where: { id: second.user.organizationId },
    });

    expect(firstOrg.publicCode).toMatch(/^RST-\d{6}$/);
    expect(secondOrg.publicCode).toMatch(/^RST-\d{6}$/);
    expect(firstOrg.publicCode).not.toEqual(secondOrg.publicCode);
  });

  it('exposes the restaurant via its public code, not its internal id', async () => {
    const result = await AuthService.register({
      organizationName: 'Public Lookup Restaurant',
      organizationEmail: 'lookup@test-restaurant.local',
      firstName: 'Ada',
      lastName: 'Owner',
      email: 'ada@lookup.local',
      password: 'SuperSecret123!',
      currency: 'PHP',
      timezone: 'Asia/Manila',
    });
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: result.user.organizationId },
    });

    const found = await RestaurantDirectoryService.getByPublicCode(org.publicCode!);
    expect(found.id).toBe(org.id);
    expect(found.name).toBe('Public Lookup Restaurant');

    await expect(RestaurantDirectoryService.getByPublicCode('RST-999999')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
