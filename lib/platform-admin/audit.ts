import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';

interface PlatformAuditEntry {
  platformAdminId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
}

/**
 * Writes a `platform_audit_logs` row — the platform-admin-side sibling of
 * `lib/audit/log.ts`'s `writeAuditLog`. See `PlatformAuditLog`'s comment in
 * schema.prisma for why this is a separate table rather than a reuse of the
 * org-scoped `AuditLog`: a platform admin action (changing the global
 * payment gateway config, issuing a refund) has no single required
 * `organizationId` to hang off of. Accepts either the shared prisma client
 * or a transaction client, same "log inside the same atomic write"
 * discipline as the org-scoped version.
 */
export async function writePlatformAuditLog(
  client: PrismaClient | Prisma.TransactionClient,
  entry: PlatformAuditEntry,
): Promise<void> {
  await client.platformAuditLog.create({
    data: {
      platformAdminId: entry.platformAdminId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      previousValue: entry.previousValue === undefined ? undefined : (entry.previousValue as Prisma.InputJsonValue),
      newValue: entry.newValue === undefined ? undefined : (entry.newValue as Prisma.InputJsonValue),
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
