import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import type { CreateDeliveryZoneInput, UpdateDeliveryZoneInput } from '@/lib/validation/delivery';

export class DeliveryZoneService {
  static async list(organizationId: string, branchId: string) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.deliveryZone.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
    });
  }

  static async get(organizationId: string, branchId: string, zoneId: string) {
    const zone = await prisma.deliveryZone.findFirst({ where: { id: zoneId, branchId, organizationId } });
    if (!zone) throw new NotFoundError('Delivery zone');
    return zone;
  }

  /**
   * CAPP Phase 5 — the diner-facing zone picker (spec § 12: "System verifies
   * delivery zone"). See docs/customer-app/architecture.md § 14 for why this
   * is a picker rather than an address-to-zone auto-match: DeliveryZone has
   * no lat/lng/polygon anywhere in this schema, and CustomerAddress has no
   * coordinates either, so there is no honest way to "detect" a zone from a
   * typed address. The diner instead picks their own zone from this branch's
   * currently-active list, same as `RestaurantDirectoryService.getPublicMenu`
   * filters out unavailable items — an inactive zone is exactly as unusable
   * to a diner right now as an unavailable menu item.
   */
  static async listActive(organizationId: string, branchId: string) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.deliveryZone.findMany({
      where: { branchId, active: true },
      orderBy: { name: 'asc' },
    });
  }

  static async create(
    organizationId: string,
    branchId: string,
    input: CreateDeliveryZoneInput,
    actorUserId: string,
  ) {
    await this.assertBranchInOrg(organizationId, branchId);
    const existing = await prisma.deliveryZone.findUnique({
      where: { branchId_name: { branchId, name: input.name } },
    });
    if (existing) throw new ConflictError(`A delivery zone named "${input.name}" already exists at this branch.`);

    return prisma.$transaction(async (tx) => {
      const zone = await tx.deliveryZone.create({
        data: {
          organizationId,
          branchId,
          name: input.name,
          description: input.description,
          deliveryFee: input.deliveryFee,
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
    const existing = await this.get(organizationId, branchId, zoneId);

    return prisma.$transaction(async (tx) => {
      const zone = await tx.deliveryZone.update({ where: { id: zoneId }, data: input });
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

  private static async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }
}
