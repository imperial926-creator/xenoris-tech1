import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError } from '@/lib/utils/api-error';
import type { UpdateOrganizationInput } from '@/lib/validation/organization';

export class OrganizationService {
  static async get(organizationId: string) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundError('Organization');
    return org;
  }

  static async update(
    organizationId: string,
    input: UpdateOrganizationInput,
    actorUserId: string,
  ) {
    const existing = await this.get(organizationId);

    const updated = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.update({
        where: { id: organizationId },
        data: input,
      });
      await writeAuditLog(tx, {
        organizationId,
        userId: actorUserId,
        action: 'organization.update',
        entityType: 'Organization',
        entityId: organizationId,
        previousValue: existing,
        newValue: org,
      });
      return org;
    });

    return updated;
  }
}
