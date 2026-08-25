import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { writePlatformAuditLog } from '@/lib/platform-admin/audit';
import type { UpdatePlatformBillingConfigInput } from '@/lib/validation/platform-billing';
import { getSubscriptionGatewayProvider } from '@/lib/platform-billing/SubscriptionGatewayProvider';

const SINGLETON_ID = 'singleton';

/**
 * Master spec §52-53's "SaaS Owner Billing Configuration" / "SaaS Owner
 * Settlement Configuration" screens. This service is the ONLY place in the
 * codebase that reads/writes `PlatformBillingConfig`, and it deliberately
 * never accepts or returns a full bank account number, API key, or webhook
 * secret — see that model's header comment in schema.prisma for exactly
 * what does and doesn't live here versus in environment variables.
 */
export class PlatformBillingConfigService {
  /**
   * Always returns a row — creates the singleton with defaults on first
   * read rather than requiring a separate "initialize" step, the same
   * "unconfigured is a valid, handled state" discipline used throughout
   * this codebase's provider factories.
   */
  static async get() {
    const config = await prisma.platformBillingConfig.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });

    // Environment-variable-backed facts are surfaced here too (read-only —
    // never stored in the DB row itself) so the admin UI's "Connection
    // Status" reflects reality even before anyone has touched the config
    // screen. This is intentionally NOT the secret value, just whether one
    // is present.
    const gatewayConfigured = getSubscriptionGatewayProvider().name !== 'unconfigured';

    return { ...config, gatewayConfigured };
  }

  static async update(input: UpdatePlatformBillingConfigInput, platformAdminId: string) {
    const before = await this.get();
    const updated = await prisma.$transaction(async (tx) => {
      const config = await tx.platformBillingConfig.upsert({
        where: { id: SINGLETON_ID },
        update: { ...input, updatedByAdminId: platformAdminId },
        create: { id: SINGLETON_ID, ...input, updatedByAdminId: platformAdminId },
      });

      await writePlatformAuditLog(tx, {
        platformAdminId,
        action: 'platform_billing_config.update',
        entityType: 'PlatformBillingConfig',
        entityId: SINGLETON_ID,
        // Redundant with the input fields, but explicit about what changed
        // vs. what the config held before — masked/non-secret fields only,
        // consistent with everything else in this table.
        previousValue: {
          paymentProvider: before.paymentProvider,
          environment: before.environment,
          recurringBillingEnabled: before.recurringBillingEnabled,
          settlementBankName: before.settlementBankName,
          settlementAccountLast4: before.settlementAccountLast4,
        },
        newValue: input,
      });

      return config;
    });

    return { ...updated, gatewayConfigured: getSubscriptionGatewayProvider().name !== 'unconfigured' };
  }

  static async recordWebhookOutcome(outcome: 'success' | 'failure') {
    await prisma.platformBillingConfig.upsert({
      where: { id: SINGLETON_ID },
      update:
        outcome === 'success'
          ? { lastSuccessfulWebhookAt: new Date(), webhookConfigured: true }
          : { lastFailedWebhookAt: new Date() },
      create: {
        id: SINGLETON_ID,
        ...(outcome === 'success'
          ? { lastSuccessfulWebhookAt: new Date(), webhookConfigured: true }
          : { lastFailedWebhookAt: new Date() }),
      },
    });
  }
}
