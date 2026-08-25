import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { DriverService } from '@/services/delivery/DriverService';
import { resetDatabase } from '../../helpers/db';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';

async function setupFixture(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Driver Test ${suffix}`,
    organizationEmail: `driver-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@driver-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  const branch = await BranchService.create(user.organizationId, { name: `Branch ${suffix}`, timezone: 'Asia/Manila' }, user.id);
  return { user, branch };
}

/** Creates a second user in the same org holding the DRIVER role — same
 * direct-prisma pattern used in tests/integration/auth/rbac.test.ts, since
 * general user creation/role-assignment isn't a built service yet. */
async function createDriverRoleUser(organizationId: string, suffix: string) {
  const driverRole = await prisma.role.findFirstOrThrow({ where: { organizationId, name: 'DRIVER' } });
  const driverUser = await prisma.user.create({
    data: {
      organizationId,
      email: `driver-${suffix}@driver-test.local`,
      passwordHash: 'irrelevant-for-this-test',
      firstName: 'Drive',
      lastName: suffix,
    },
  });
  await prisma.userRole.create({ data: { userId: driverUser.id, roleId: driverRole.id, organizationId } });
  return driverUser;
}

describe('DriverService', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a driver profile for a user holding the DRIVER role', async () => {
    const { user, branch } = await setupFixture('a');
    const driverUser = await createDriverRoleUser(user.organizationId, 'a');
    const driver = await DriverService.create(
      user.organizationId, branch.id, { userId: driverUser.id, vehicleType: 'Motorcycle' }, user.id,
    );
    expect(driver.userId).toBe(driverUser.id);
    expect(driver.active).toBe(true);
  });

  it('rejects creating a driver profile for a user without the DRIVER role', async () => {
    const { user, branch } = await setupFixture('b');
    // The org owner themself holds OWNER, not DRIVER.
    await expect(
      DriverService.create(user.organizationId, branch.id, { userId: user.id }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects creating a second driver profile for the same user', async () => {
    const { user, branch } = await setupFixture('c');
    const driverUser = await createDriverRoleUser(user.organizationId, 'c');
    await DriverService.create(user.organizationId, branch.id, { userId: driverUser.id }, user.id);
    await expect(
      DriverService.create(user.organizationId, branch.id, { userId: driverUser.id }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('listEligibleUsers only returns DRIVER-role users without an existing profile', async () => {
    const { user, branch } = await setupFixture('d');
    const eligible = await createDriverRoleUser(user.organizationId, 'd-eligible');
    const alreadyHasProfile = await createDriverRoleUser(user.organizationId, 'd-has-profile');
    await DriverService.create(user.organizationId, branch.id, { userId: alreadyHasProfile.id }, user.id);

    const eligibleUsers = await DriverService.listEligibleUsers(user.organizationId);
    const ids = eligibleUsers.map((u) => u.id);
    expect(ids).toContain(eligible.id);
    expect(ids).not.toContain(alreadyHasProfile.id);
    expect(ids).not.toContain(user.id); // owner never had the DRIVER role
  });

  it('getByUserId finds the calling user\'s own driver profile', async () => {
    const { user, branch } = await setupFixture('e');
    const driverUser = await createDriverRoleUser(user.organizationId, 'e');
    const driver = await DriverService.create(user.organizationId, branch.id, { userId: driverUser.id }, user.id);
    const found = await DriverService.getByUserId(user.organizationId, driverUser.id);
    expect(found.id).toBe(driver.id);
  });

  it('getByUserId throws NotFoundError when the user has no driver profile', async () => {
    const { user } = await setupFixture('f');
    await expect(DriverService.getByUserId(user.organizationId, user.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('does not leak a driver profile across organizations', async () => {
    const orgA = await setupFixture('g');
    const orgB = await setupFixture('h');
    const driverUserA = await createDriverRoleUser(orgA.user.organizationId, 'g');
    const driver = await DriverService.create(orgA.user.organizationId, orgA.branch.id, { userId: driverUserA.id }, orgA.user.id);

    await expect(
      DriverService.get(orgB.user.organizationId, orgB.branch.id, driver.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deactivates a driver via update', async () => {
    const { user, branch } = await setupFixture('i');
    const driverUser = await createDriverRoleUser(user.organizationId, 'i');
    const driver = await DriverService.create(user.organizationId, branch.id, { userId: driverUser.id }, user.id);
    const updated = await DriverService.update(user.organizationId, branch.id, driver.id, { active: false }, user.id);
    expect(updated.active).toBe(false);
  });
});
