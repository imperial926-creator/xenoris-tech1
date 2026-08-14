import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';

interface AuditEntry {
  organizationId: string;
  branchId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
}

/**
 * Writes an audit_logs row. Accepts either the shared prisma client or a
 * transaction client so services can log as part of the same atomic write
 * that produced the change (e.g. "update branch" and "audit that update"
 * either both commit or both roll back).
 */
export async function writeAuditLog(
  client: PrismaClient | Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  await client.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      branchId: entry.branchId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      previousValue: entry.previousValue === undefined ? undefined : (entry.previousValue as Prisma.InputJsonValue),
      newValue: entry.newValue === undefined ? undefined : (entry.newValue as Prisma.InputJsonValue),
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
