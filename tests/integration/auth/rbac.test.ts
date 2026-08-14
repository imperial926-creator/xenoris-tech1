import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { userHasPermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { resetDatabase } from '../../helpers/db';

describe('userHasPermission', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('grants the OWNER every seeded permission', async () => {
    const { user } = await AuthService.register({
      organizationName: 'Perm Test Co',
      organizationEmail: 'org@perm-test.local',
      firstName: 'Own',
      lastName: 'Er',
      email: 'owner@perm-test.local',
      password: 'SuperSecret123!',
      currency: 'PHP',
      timezone: 'Asia/Manila',
    });

    const allowed = await userHasPermission(user.id, user.organizationId, PERMISSIONS.FINANCE_MANAGE);
    expect(allowed).toBe(true);
  });

  it('denies a CUSTOMER-role user any administrative permission', async () => {
    const { user } = await AuthService.register({
      organizationName: 'Perm Test Co 2',
      organizationEmail: 'org2@perm-test.local',
      firstName: 'Own',
      lastName: 'Er',
      email: 'owner2@perm-test.local',
      password: 'SuperSecret123!',
      currency: 'PHP',
      timezone: 'Asia/Manila',
    });

    // Demote: create a second user in the same org holding only the CUSTOMER role.
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    const customerRole = await prisma.role.findFirstOrThrow({
      where: { organizationId: org.id, name: 'CUSTOMER' },
    });
    const customerUser = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: 'customer@perm-test.local',
        passwordHash: 'irrelevant-for-this-test',
        firstName: 'Cust',
        lastName: 'Omer',
      },
    });
    await prisma.userRole.create({
      data: { userId: customerUser.id, roleId: customerRole.id, organizationId: org.id },
    });

    const allowed = await userHasPermission(
      customerUser.id,
      org.id,
      PERMISSIONS.BRANCH_MANAGE,
    );
    expect(allowed).toBe(false);
  });

  it('does not leak a permission granted in one organization into another', async () => {
    const orgA = await AuthService.register({
      organizationName: 'Org A',
      organizationEmail: 'org-a@perm-test.local',
      firstName: 'A',
      lastName: 'Owner',
      email: 'owner@org-a.local',
      password: 'SuperSecret123!',
      currency: 'PHP',
      timezone: 'Asia/Manila',
    });
    const orgB = await AuthService.register({
      organizationName: 'Org B',
      organizationEmail: 'org-b@perm-test.local',
      firstName: 'B',
      lastName: 'Owner',
      email: 'owner@org-b.local',
      password: 'SuperSecret123!',
      currency: 'PHP',
      timezone: 'Asia/Manila',
    });

    // orgA's owner should not have permissions when checked against orgB's id.
    const allowed = await userHasPermission(
      orgA.user.id,
      orgB.user.organizationId,
      PERMISSIONS.ORG_MANAGE,
    );
    expect(allowed).toBe(false);
  });
});
