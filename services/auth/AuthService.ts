import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSessionToken, type SessionPayload } from '@/lib/auth/session';
import { writeAuditLog } from '@/lib/audit/log';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_NAMES, PERMISSION_CATALOG } from '@/lib/auth/constants';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';
import type { LoginInput, RegisterInput } from '@/lib/validation/auth';

export interface AuthResult {
  token: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    organizationId: string;
    roles: string[];
  };
}

export class AuthService {
  /**
   * Registers a brand-new Organization plus its first User, seeded with the
   * platform's default roles/permissions for that organization, and grants
   * the new user the OWNER role. Everything happens in one transaction so a
   * failure partway through never leaves an org without an owner or a user
   * without a role.
   */
  static async register(input: RegisterInput, ipAddress?: string | null): Promise<AuthResult> {
    const existingOrg = await prisma.organization.findUnique({
      where: { email: input.organizationEmail },
    });
    if (existingOrg) {
      throw new ConflictError('An organization is already registered with that email.');
    }

    const passwordHash = await hashPassword(input.password);

    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.organizationName,
          email: input.organizationEmail,
          currency: input.currency,
          timezone: input.timezone,
        },
      });

      // Ensure the global permission catalog exists (idempotent upsert — safe
      // to run on every registration, cheap after the first time).
      await Promise.all(
        PERMISSION_CATALOG.map((p) =>
          tx.permission.upsert({
            where: { key: p.key },
            update: {},
            create: { key: p.key, description: p.description },
          }),
        ),
      );
      const permissions = await tx.permission.findMany();
      const permissionByKey = new Map(permissions.map((p) => [p.key, p.id]));

      // Seed the seven standard roles for this organization with default grants.
      const roleRecords = await Promise.all(
        ROLE_NAMES.map((name) =>
          tx.role.create({ data: { organizationId: organization.id, name } }),
        ),
      );
      for (const role of roleRecords) {
        const grants = DEFAULT_ROLE_PERMISSIONS[role.name];
        if (grants.length > 0) {
          await tx.rolePermission.createMany({
            data: grants
              .map((key) => permissionByKey.get(key))
              .filter((id): id is string => Boolean(id))
              .map((permissionId) => ({ roleId: role.id, permissionId })),
          });
        }
      }

      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
        },
      });

      const ownerRole = roleRecords.find((r) => r.name === 'OWNER');
      if (!ownerRole) throw new Error('OWNER role was not seeded — this is a bug.');
      await tx.userRole.create({
        data: { userId: user.id, roleId: ownerRole.id, organizationId: organization.id },
      });

      await writeAuditLog(tx, {
        organizationId: organization.id,
        userId: user.id,
        action: 'auth.register',
        entityType: 'Organization',
        entityId: organization.id,
        newValue: { organizationName: organization.name, ownerEmail: user.email },
        ipAddress,
      });

      return { organization, user };
    });

    const token = await createSessionToken({
      userId: result.user.id,
      organizationId: result.organization.id,
      email: result.user.email,
      roles: ['OWNER'],
    });

    return {
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        organizationId: result.organization.id,
        roles: ['OWNER'],
      },
    };
  }

  /**
   * Logs a user in. Because email is unique per-organization (not globally),
   * the caller must supply which organization to authenticate against via
   * its (globally unique) organization email. See lib/validation/auth.ts for
   * the reasoning and docs/architecture.md for the UX follow-up planned for
   * Phase 2 (friendlier org lookup / subdomain routing).
   */
  static async login(input: LoginInput, ipAddress?: string | null): Promise<AuthResult> {
    const organization = await prisma.organization.findUnique({
      where: { email: input.organizationEmail },
    });
    if (!organization) {
      // Same generic message as a bad password — do not reveal whether the
      // organization exists.
      throw new NotFoundError('Account');
    }

    const user = await prisma.user.findUnique({
      where: { organizationId_email: { organizationId: organization.id, email: input.email } },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      throw new NotFoundError('Account');
    }

    const passwordOk = await verifyPassword(input.password, user.passwordHash);
    if (!passwordOk) {
      await writeAuditLog(prisma, {
        organizationId: organization.id,
        userId: user.id,
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user.id,
        ipAddress,
      });
      throw new NotFoundError('Account');
    }

    const roles: string[] = Array.from(new Set<string>(user.userRoles.map((ur) => ur.role.name)));

    await writeAuditLog(prisma, {
      organizationId: organization.id,
      userId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      ipAddress,
    });

    const token = await createSessionToken({
      userId: user.id,
      organizationId: organization.id,
      email: user.email,
      roles,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        organizationId: organization.id,
        roles,
      },
    };
  }

  static async getSessionUser(session: SessionPayload) {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        organizationId: true,
        status: true,
        organization: { select: { id: true, name: true, currency: true, timezone: true } },
        userRoles: { select: { role: { select: { name: true } }, branchId: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new NotFoundError('Account');
    }
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      organization: user.organization,
      roles: user.userRoles.map((ur) => ({ name: ur.role.name, branchId: ur.branchId })),
    };
  }
}
