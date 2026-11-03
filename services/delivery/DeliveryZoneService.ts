
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import type {
  CreateDeliveryZoneInput,
  UpdateDeliveryZoneInput,
} from '@/lib/validation/delivery';

export class DeliveryZoneService {
  static async list(organizationId: string, branchId: string) {
    await this.assertBranchInOrg(organizationId, branchId);

    return prisma.deliveryZone.findMany({
      where: { organizationId, branchId },
      orderBy: { name: 'asc' },
    });
  }

  static async get(
    organizationId: string,
    branchId: string,
    zoneId: string,
  ) {
    const zone = await prisma.deliveryZone.findFirst({
      where: {
        id: zoneId,
        branchId,
        organizationId,
      },
    });

    if (!zone) {
      throw new NotFoundError('Delivery zone');
    }

    return zone;
  }

  static async create(
    organizationId: string,
    branchId: string,
    input: CreateDeliveryZoneInput,
    actorUserId: string,
  ) {
    await this.assertBranchInOrg(organizationId, branchId);

    const existing = await prisma.deliveryZone.findFirst({
      where: {
        organizationId,
        branchId,
        name: input.name,
        active: true,
      },
    });

    if (existing) {
      throw new ConflictError(
        'A delivery zone with this name already exists.',
      );
    }

    return prisma.$transaction(async (tx) => {
      const zone = await tx.deliveryZone.create({
        data: {
          organizationId,
          branchId,
          ...input,
        },
      });

      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'delivery_zone.create',
        entityType: 'DeliveryZone',
        entityId: zone.id,
        newValue: zone,
      });

      return zone;
    });
  }

  static async update(
    organizationId: string,
    branchId: string,
    zoneId: string,
    input: UpdateDeliveryZoneInput,
    actorUserId: string,
  ) {
    const existing = await this.get(
      organizationId,
      branchId,
      zoneId,
    );

    if (input.name && input.name !== existing.name) {
      const duplicate = await prisma.deliveryZone.findFirst({
        where: {
          organizationId,
          branchId,
          name: input.name,
          active: true,
          NOT: { id: zoneId },
        },
      });

      if (duplicate) {
        throw new ConflictError(
          'A delivery zone with this name already exists.',
        );
      }
    }

    return prisma.$transaction(async (tx) => {
      const zone = await tx.deliveryZone.update({
        where: { id: zoneId },
        data: input,
      });

      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'delivery_zone.update',
        entityType: 'DeliveryZone',
        entityId: zone.id,
        previousValue: existing,
        newValue: zone,
      });

      return zone;
    });
  }

  private static async assertBranchInOrg(
    organizationId: string,
    branchId: string,
  ) {
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new NotFoundError('Branch');
    }

    return branch;
  }
}

