import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import type { CreateDriverInput, UpdateDriverInput } from '@/lib/validation/delivery';

export class DriverService {
  static async list(organizationId: string, branchId: string) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.driver.findMany({
      where: { branchId },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Users with the DRIVER role who don't already have a driver profile —
   * just enough to populate the "create a driver profile" picker. NOT a
   * general user-directory endpoint: full staff/user management (the
   * USER_VIEW permission's real implementation) is still Phase 1's
   * unimplemented forward-looking placeholder, out of scope here. This is
   * intentionally narrow: one query, gated by the same delivery:manage
   * permission as the rest of this domain.
   */
  static async listEligibleUsers(organizationId: string) {
    return prisma.user.findMany({
      where: {
        organizationId,
        deletedAt: null,
        userRoles: { some: { role: { name: 'DRIVER' } } },
        driverProfile: null,
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: { firstName: 'asc' },
    });
  }

  static async get(organizationId: string, branchId: string, driverId: string) {
    const driver = await prisma.driver.findFirst({
      where: { id: driverId, branchId, organizationId },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });
    if (!driver) throw new NotFoundError('Driver');
    return driver;
  }

  /**
   * Looks up the Driver profile for the currently-authenticated user, if
   * any — used by the driver-scoped "my deliveries" endpoint. Not scoped to
   * a specific branch, since a driver profile belongs to exactly one branch
   * already (drivers.branchId).
   */
  static async getByUserId(organizationId: string, userId: string) {
    const driver = await prisma.driver.findFirst({ where: { userId, organizationId } });
    if (!driver) throw new NotFoundError('Driver profile for the current user');
    return driver;
  }

  static async create(
    organizationId: string,
    branchId: string,
    input: CreateDriverInput,
    actorUserId: string,
  ) {
    await this.assertBranchInOrg(organizationId, branchId);

    const user = await prisma.user.findFirst({
      where: { id: input.userId, organizationId },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundError('User');

    const hasDriverRole = user.userRoles.some((ur) => ur.role.name === 'DRIVER');
    if (!hasDriverRole) {
      throw new ConflictError(`${user.firstName} ${user.lastName} does not have the DRIVER role — grant it before creating a driver profile.`);
    }

    const existing = await prisma.driver.findUnique({ where: { userId: input.userId } });
    if (existing) throw new ConflictError('This user already has a driver profile.');

    return prisma.$transaction(async (tx) => {
      const driver = await tx.driver.create({
        data: {
          organizationId,
          branchId,
          userId: input.userId,
          vehicleType: input.vehicleType,
          vehiclePlate: input.vehiclePlate,
          phone: input.phone,
        },
      });
      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'driver.create',
        entityType: 'Driver',
        entityId: driver.id,
        newValue: driver,
      });
      return driver;
    });
  }

  static async update(
    organizationId: string,
    branchId: string,
    driverId: string,
    input: UpdateDriverInput,
    actorUserId: string,
  ) {
    const existing = await this.get(organizationId, branchId, driverId);

    return prisma.$transaction(async (tx) => {
      const driver = await tx.driver.update({ where: { id: driverId }, data: input });
      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'driver.update',
        entityType: 'Driver',
        entityId: driver.id,
        previousValue: existing,
        newValue: driver,
      });
      return driver;
    });
  }

  private static async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }
}
