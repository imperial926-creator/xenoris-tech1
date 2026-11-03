import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import type {
  CreateTableInput,
  CreateTableSectionInput,
  UpdateTableInput,
  UpdateTableSectionInput,
  UpdateTableStatusInput,
} from '@/lib/validation/table';
import type { TableStatus } from '@prisma/client';

/**
 * Legal table status transitions. Deliberately a whitelist, not "anything
 * goes" — a table jumping straight from OUT_OF_SERVICE to OCCUPIED, or
 * CLEANING back to RESERVED, is very likely a bug or a miskeyed action, not
 * a real operational flow. Rejected server-side regardless of what the UI
 * offers, per CLAUDE.md's "never trust client state for state machines" rule
 * of thumb (the spec calls this out explicitly for money; the same logic
 * applies to any operationally meaningful state machine).
 */
const ALLOWED_TRANSITIONS: Record<TableStatus, TableStatus[]> = {
  AVAILABLE: ['RESERVED', 'OCCUPIED', 'WAITING', 'OUT_OF_SERVICE'],
  RESERVED: ['OCCUPIED', 'AVAILABLE', 'OUT_OF_SERVICE'],
  WAITING: ['OCCUPIED', 'AVAILABLE', 'OUT_OF_SERVICE'],
  OCCUPIED: ['CLEANING', 'OUT_OF_SERVICE'],
  CLEANING: ['AVAILABLE', 'OUT_OF_SERVICE'],
  OUT_OF_SERVICE: ['AVAILABLE'],
};

export class TableService {
  // --- Sections -------------------------------------------------------

  static async listSections(organizationId: string, branchId: string) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.tableSection.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
    });
  }

  static async createSection(
    organizationId: string,
    branchId: string,
    input: CreateTableSectionInput,
    actorUserId: string,
  ) {
    
const existing = await prisma.tableSection.findFirst({
  where: {
    branchId,
    name: input.name,
    active: true,
  },
});
    if (existing) throw new ConflictError(`A section named "${input.name}" already exists at this branch.`);

    return prisma.$transaction(async (tx) => {
      const section = await tx.tableSection.create({
        data: { organizationId, branchId, name: input.name, description: input.description },
      });
      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'table_section.create',
        entityType: 'TableSection',
        entityId: section.id,
        newValue: section,
      });
      return section;
    });
  }

  static async updateSection(
    organizationId: string,
    branchId: string,
    sectionId: string,
    input: UpdateTableSectionInput,
    actorUserId: string,
  ) {
    const existing = await this.getSection(organizationId, branchId, sectionId);
    return prisma.$transaction(async (tx) => {
      const section = await tx.tableSection.update({ where: { id: sectionId }, data: input });
      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'table_section.update',
        entityType: 'TableSection',
        entityId: section.id,
        previousValue: existing,
        newValue: section,
      });
      return section;
    });
  }

  static async getSection(organizationId: string, branchId: string, sectionId: string) {
    const section = await prisma.tableSection.findFirst({
      where: { id: sectionId, branchId, organizationId },
    });
    if (!section) throw new NotFoundError('Table section');
    return section;
  }

  // --- Tables -----------------------------------------------------------

  static async listTables(organizationId: string, branchId: string) {
    await this.assertBranchInOrg(organizationId, branchId);
    return prisma.restaurantTable.findMany({
      where: { branchId },
      include: { section: true },
      orderBy: { tableNumber: 'asc' },
    });
  }

  static async getTable(organizationId: string, branchId: string, tableId: string) {
    const table = await prisma.restaurantTable.findFirst({
      where: { id: tableId, branchId, organizationId },
      include: { section: true },
    });
    if (!table) throw new NotFoundError('Table');
    return table;
  }

  static async createTable(
    organizationId: string,
    branchId: string,
    input: CreateTableInput,
    actorUserId: string,
  ) {
    await this.assertBranchInOrg(organizationId, branchId);
    if (input.sectionId) {
      await this.getSection(organizationId, branchId, input.sectionId);
    }
    const existing = await prisma.restaurantTable.findUnique({
      where: { branchId_tableNumber: { branchId, tableNumber: input.tableNumber } },
    });
    if (existing) {
      throw new ConflictError(`Table "${input.tableNumber}" already exists at this branch.`);
    }

    return prisma.$transaction(async (tx) => {
      const table = await tx.restaurantTable.create({
        data: {
          organizationId,
          branchId,
          sectionId: input.sectionId,
          tableNumber: input.tableNumber,
          capacity: input.capacity,
        },
      });
      await tx.tableStatusHistory.create({
        data: { tableId: table.id, fromStatus: null, toStatus: table.status, changedByUserId: actorUserId },
      });
      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'table.create',
        entityType: 'RestaurantTable',
        entityId: table.id,
        newValue: table,
      });
      return table;
    });
  }

  static async updateTable(
    organizationId: string,
    branchId: string,
    tableId: string,
    input: UpdateTableInput,
    actorUserId: string,
  ) {
    const existing = await this.getTable(organizationId, branchId, tableId);
    if (input.sectionId) {
      await this.getSection(organizationId, branchId, input.sectionId);
    }

    return prisma.$transaction(async (tx) => {
      const table = await tx.restaurantTable.update({ where: { id: tableId }, data: input });
      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'table.update',
        entityType: 'RestaurantTable',
        entityId: table.id,
        previousValue: existing,
        newValue: table,
      });
      return table;
    });
  }

  /**
   * Transitions a table's status, validating the move against
   * ALLOWED_TRANSITIONS and recording it in table_status_history — this is
   * the audit trail hostesses/managers rely on to answer "who sat table 12
   * and when."
   */
  static async updateStatus(
    organizationId: string,
    branchId: string,
    tableId: string,
    input: UpdateTableStatusInput,
    actorUserId: string,
  ) {
    const table = await this.getTable(organizationId, branchId, tableId);

    if (table.status === input.status) {
      // No-op transitions are not an error, just nothing to record.
      return table;
    }

    const allowed = ALLOWED_TRANSITIONS[table.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Cannot move table from ${table.status} to ${input.status}. Allowed next states: ${allowed.join(', ') || 'none'}.`,
      );
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.restaurantTable.update({
        where: { id: tableId },
        data: { status: input.status },
      });
      await tx.tableStatusHistory.create({
        data: {
          tableId,
          fromStatus: table.status,
          toStatus: input.status,
          changedByUserId: actorUserId,
          note: input.note,
        },
      });
      await writeAuditLog(tx, {
        organizationId,
        branchId,
        userId: actorUserId,
        action: 'table.status_change',
        entityType: 'RestaurantTable',
        entityId: tableId,
        previousValue: { status: table.status },
        newValue: { status: input.status, note: input.note },
      });
      return updated;
    });
  }

  static async getStatusHistory(organizationId: string, branchId: string, tableId: string) {
    await this.getTable(organizationId, branchId, tableId);
    return prisma.tableStatusHistory.findMany({
      where: { tableId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  private static async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }
}
