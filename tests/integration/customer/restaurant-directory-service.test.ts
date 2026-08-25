import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { resetDatabase } from '../../helpers/db';
import { NotFoundError } from '@/lib/utils/api-error';

async function registerOrg(suffix: string) {
  return AuthService.register({
    organizationName: `Directory Org ${suffix}`,
    organizationEmail: `directory-org-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@directory-org-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
}

describe('RestaurantDirectoryService branding management', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('getBranding returns null before any branding is configured', async () => {
    const org = await registerOrg('branding-1');
    const branding = await RestaurantDirectoryService.getBranding(org.user.organizationId);
    expect(branding).toBeNull();
  });

  it('upsertBranding creates a row on first call and updates it on the next', async () => {
    const org = await registerOrg('branding-2');
    const created = await RestaurantDirectoryService.upsertBranding(
      org.user.organizationId,
      { description: 'Cozy neighborhood grill.', primaryColor: '#1E3A8A' },
      org.user.id,
    );
    expect(created.description).toBe('Cozy neighborhood grill.');
    expect(created.primaryColor).toBe('#1E3A8A');

    const updated = await RestaurantDirectoryService.upsertBranding(
      org.user.organizationId,
      { description: 'Updated description.' },
      org.user.id,
    );
    expect(updated.id).toBe(created.id); // same row, not a duplicate
    expect(updated.description).toBe('Updated description.');

    const fetched = await RestaurantDirectoryService.getBranding(org.user.organizationId);
    expect(fetched?.description).toBe('Updated description.');
  });

  it('writes an audit log entry distinguishing create from update', async () => {
    const org = await registerOrg('branding-3');
    await RestaurantDirectoryService.upsertBranding(
      org.user.organizationId,
      { description: 'First.' },
      org.user.id,
    );
    await RestaurantDirectoryService.upsertBranding(
      org.user.organizationId,
      { description: 'Second.' },
      org.user.id,
    );

    const logs = await prisma.auditLog.findMany({
      where: { organizationId: org.user.organizationId, entityType: 'RestaurantBranding' },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => l.action)).toEqual(['branding.create', 'branding.update']);
  });

  it('rejects branding for a nonexistent organization', async () => {
    await expect(
      RestaurantDirectoryService.upsertBranding('not-a-real-org-id', {}, 'not-a-real-user-id'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('RestaurantDirectoryService.getByPublicCode — location and OPEN/CLOSED status', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns location: null when the organization has no branches yet', async () => {
    const org = await registerOrg('loc-1');
    const orgRow = await prisma.organization.findUniqueOrThrow({
      where: { id: org.user.organizationId },
    });

    const restaurant = await RestaurantDirectoryService.getByPublicCode(orgRow.publicCode!);
    expect(restaurant.location).toBeNull();
  });

  it('exposes the longest-standing ACTIVE branch as the storefront location', async () => {
    const org = await registerOrg('loc-2');
    await BranchService.create(
      org.user.organizationId,
      { name: 'Original Branch', address: '123 Rizal St', timezone: 'Asia/Manila' },
      org.user.id,
    );
    await BranchService.create(
      org.user.organizationId,
      { name: 'Newer Branch', address: '456 Mabini Ave', timezone: 'Asia/Manila' },
      org.user.id,
    );

    const orgRow = await prisma.organization.findUniqueOrThrow({
      where: { id: org.user.organizationId },
    });
    const restaurant = await RestaurantDirectoryService.getByPublicCode(orgRow.publicCode!);
    expect(restaurant.location?.address).toBe('123 Rizal St');
  });

  it('computes isOpenNow from the branch\'s configured opening hours', async () => {
    const org = await registerOrg('loc-3');
    const branch = await BranchService.create(
      org.user.organizationId,
      { name: 'Hours Branch', timezone: 'Asia/Manila' },
      org.user.id,
    );
    // Give every day the same wide-open window so the assertion is stable
    // regardless of which day this test happens to run on.
    const allWideOpen = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '00:00', close: '23:59' }]),
    );
    await prisma.branch.update({ where: { id: branch.id }, data: { openingHours: allWideOpen } });

    const orgRow = await prisma.organization.findUniqueOrThrow({
      where: { id: org.user.organizationId },
    });
    const restaurant = await RestaurantDirectoryService.getByPublicCode(orgRow.publicCode!);
    expect(restaurant.location?.isOpenNow).toBe(true);
  });

  it('reports closed when the branch is TEMPORARILY_CLOSED regardless of hours', async () => {
    const org = await registerOrg('loc-4');
    const branch = await BranchService.create(
      org.user.organizationId,
      { name: 'Closed Branch', timezone: 'Asia/Manila' },
      org.user.id,
    );
    const allWideOpen = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '00:00', close: '23:59' }]),
    );
    await prisma.branch.update({
      where: { id: branch.id },
      data: { openingHours: allWideOpen, status: 'TEMPORARILY_CLOSED' },
    });

    const orgRow = await prisma.organization.findUniqueOrThrow({
      where: { id: org.user.organizationId },
    });
    const restaurant = await RestaurantDirectoryService.getByPublicCode(orgRow.publicCode!);
    expect(restaurant.location?.isOpenNow).toBe(false);
  });
});
