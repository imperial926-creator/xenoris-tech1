import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError } from '@/lib/utils/api-error';
import type { CreateBranchInput, UpdateBranchInput } from '@/lib/validation/branch';

export class BranchService {
  static async list(organizationId: string) {
    return prisma.branch.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  static async get(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }

  static async create(organizationId: string, input: CreateBranchInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({
        data: {
          organizationId,
          name: input.name,
          address: input.address,
          phone: input.phone,
          email: input.email,
          timezone: input.timezone,
          openingHours: input.openingHours,
        },
      });
      await writeAuditLog(tx, {
        organizationId,
        branchId: branch.id,
        userId: actorUserId,
        action: 'branch.create',
        entityType: 'Branch',
        entityId: branch.id,
        newValue: branch,
      });
      return branch;
    });
  }

  static async update(
    organizationId: string,
    branchId: string,
    input: UpdateBranchInput,
    actorUserId: string,
  ) {
    const existing = await this.get(organizationId, branchId);

    return prisma.$transaction(async (tx) => {
      const branch = await tx.branch.update({
        where: { id: branchId },
        data: input,
      });
      await writeAuditLog(tx, {
        organizationId,
        branchId: branch.id,
        userId: actorUserId,
        action: 'branch.update',
        entityType: 'Branch',
        entityId: branch.id,
        previousValue: existing,
        newValue: branch,
      });
      return branch;
    });
  }

  /**
   * Branches are never hard-deleted — they may have historical orders,
   * reservations, or financial records attached in later phases. "Deleting" a
   * branch sets it INACTIVE.
   */
  static async deactivate(organizationId: string, branchId: string, actorUserId: string) {
    const existing = await this.get(organizationId, branchId);

    return prisma.$transaction(async (tx) => {
      const branch = await tx.branch.update({
        where: { id: branchId },
        data: { status: 'INACTIVE' },
      });
      await writeAuditLog(tx, {
        organizationId,
        branchId: branch.id,
        userId: actorUserId,
        action: 'branch.deactivate',
        entityType: 'Branch',
        entityId: branch.id,
        previousValue: existing,
        newValue: branch,
      });
      return branch;
    });
  }
}
