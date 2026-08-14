import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { resetDatabase } from '../../helpers/db';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';

const baseRegisterInput = {
  organizationName: 'Test Restaurant',
  organizationEmail: 'org@test-restaurant.local',
  firstName: 'Ada',
  lastName: 'Owner',
  email: 'ada@test-restaurant.local',
  password: 'SuperSecret123!',
  currency: 'PHP',
  timezone: 'Asia/Manila',
};

describe('AuthService', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('registers a new organization and its owner user', async () => {
    const result = await AuthService.register(baseRegisterInput);
    expect(result.token).toBeTruthy();
    expect(result.user.email).toBe(baseRegisterInput.email);
    expect(result.user.roles).toEqual(['OWNER']);

    const org = await prisma.organization.findUnique({
      where: { email: baseRegisterInput.organizationEmail },
    });
    expect(org).not.toBeNull();

    // All seven roles should exist for the new organization.
    const roles = await prisma.role.findMany({ where: { organizationId: org!.id } });
    expect(roles).toHaveLength(7);
  });

  it('rejects registering a second organization with the same organization email', async () => {
    await AuthService.register(baseRegisterInput);
    await expect(AuthService.register(baseRegisterInput)).rejects.toBeInstanceOf(ConflictError);
  });

  it('logs the owner in with correct credentials', async () => {
    await AuthService.register(baseRegisterInput);
    const result = await AuthService.login({
      organizationEmail: baseRegisterInput.organizationEmail,
      email: baseRegisterInput.email,
      password: baseRegisterInput.password,
    });
    expect(result.user.email).toBe(baseRegisterInput.email);
    expect(result.user.roles).toContain('OWNER');
  });

  it('rejects login with the wrong password', async () => {
    await AuthService.register(baseRegisterInput);
    await expect(
      AuthService.login({
        organizationEmail: baseRegisterInput.organizationEmail,
        email: baseRegisterInput.email,
        password: 'totally-wrong',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects login against a nonexistent organization', async () => {
    await expect(
      AuthService.login({
        organizationEmail: 'nope@nowhere.local',
        email: 'ada@test-restaurant.local',
        password: 'SuperSecret123!',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('allows the same email address to register owners in two different organizations', async () => {
    await AuthService.register(baseRegisterInput);
    const second = await AuthService.register({
      ...baseRegisterInput,
      organizationName: 'Another Restaurant',
      organizationEmail: 'org@another-restaurant.local',
    });
    expect(second.user.email).toBe(baseRegisterInput.email);
  });
});
