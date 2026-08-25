import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export type MrrMovementType = 'NEW' | 'EXPANSION' | 'CONTRACTION' | 'CHURNED' | 'REACTIVATION';

/**
 * Master Data Analytics spec's MRR movement breakdown (Revenue Analytics
 * section): every MRR change is attributed to exactly one bucket so
 * `NET NEW MRR = NEW + EXPANSION + REACTIVATION - CONTRACTION - CHURNED`
 * (the spec's own explicit formula) is a plain sum over one period's rows,
 * never a derived estimate. `record()` is called at the same points
 * `SubscriptionService`/`SubscriptionWebhookService` already change
 * `Subscription.status` or `planId` — see those files for the call sites.
 */
export class MrrMovementService {
  static async record(
    client: PrismaClient | Prisma.TransactionClient,
    params: {
      organizationId: string;
      subscriptionId: string;
      type: MrrMovementType;
      amount: number | string;
      previousPlanId?: string;
      newPlanId?: string;
      occurredAt?: Date;
    },
  ) {
    return client.mrrMovementEvent.create({
      data: {
        organizationId: params.organizationId,
        subscriptionId: params.subscriptionId,
        type: params.type,
        amount: params.amount,
        previousPlanId: params.previousPlanId,
        newPlanId: params.newPlanId,
        occurredAt: params.occurredAt ?? new Date(),
      },
    });
  }

  /** The master spec's exact formula, computed over a date range. */
  static async movementReport(range: { startDate: Date; endDate: Date }) {
    const rows = await prisma.mrrMovementEvent.groupBy({
      by: ['type'],
      where: { occurredAt: { gte: range.startDate, lte: range.endDate } },
      _sum: { amount: true },
    });

    const byType: Record<MrrMovementType, number> = {
      NEW: 0,
      EXPANSION: 0,
      CONTRACTION: 0,
      CHURNED: 0,
      REACTIVATION: 0,
    };
    for (const row of rows) {
      byType[row.type as MrrMovementType] = Number(row._sum.amount ?? 0);
    }

    const netNewMrr = byType.NEW + byType.EXPANSION + byType.REACTIVATION - byType.CONTRACTION - byType.CHURNED;

    return {
      newMrr: byType.NEW.toFixed(2),
      expansionMrr: byType.EXPANSION.toFixed(2),
      contractionMrr: byType.CONTRACTION.toFixed(2),
      churnedMrr: byType.CHURNED.toFixed(2),
      reactivationMrr: byType.REACTIVATION.toFixed(2),
      netNewMrr: netNewMrr.toFixed(2),
    };
  }
}
