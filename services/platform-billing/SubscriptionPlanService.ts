import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { writePlatformAuditLog } from '@/lib/platform-admin/audit';
import type { CreateSubscriptionPlanInput, UpdateSubscriptionPlanInput } from '@/lib/validation/platform-billing';

/**
 * Master spec §7: "Display the available subscription packages configured
 * by the SaaS Owner ... The SaaS Owner must be able to edit pricing without
 * changing application source code." Plans are plain rows a PlatformAdmin
 * edits through the admin UI — nothing in this codebase hard-codes a price.
 */
export class SubscriptionPlanService {
  /** Restaurant-owner-facing: only ACTIVE plans, in display order. */
  static async listActive() {
    return prisma.subscriptionPlan.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { displayOrder: 'asc' },
    });
  }

  /** Platform-admin-facing: every plan, including archived. */
  static async listAll() {
    return prisma.subscriptionPlan.findMany({ orderBy: { displayOrder: 'asc' } });
  }

  static async get(planId: string) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundError('Subscription plan');
    return plan;
  }

  static async create(input: CreateSubscriptionPlanInput, platformAdminId: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        const plan = await tx.subscriptionPlan.create({
          data: {
            planCode: input.planCode,
            name: input.name,
            description: input.description,
            monthlyPrice: input.monthlyPrice,
            promoPrice: input.promoPrice,
            promoValidUntil: input.promoValidUntil,
            billingIntervalMonths: input.billingIntervalMonths,
            currency: input.currency,
            features: input.features,
            usageLimits: input.usageLimits,
            displayOrder: input.displayOrder,
          },
        });
        await writePlatformAuditLog(tx, {
          platformAdminId,
          action: 'subscription_plan.create',
          entityType: 'SubscriptionPlan',
          entityId: plan.id,
          newValue: input,
        });
        return plan;
      });
    } catch (error) {
      throw this.translateDbError(error);
    }
  }

  static async update(planId: string, input: UpdateSubscriptionPlanInput, platformAdminId: string) {
    const existing = await this.get(planId);
    try {
      return await prisma.$transaction(async (tx) => {
        const plan = await tx.subscriptionPlan.update({
          where: { id: planId },
          data: input,
        });
        await writePlatformAuditLog(tx, {
          platformAdminId,
          action: 'subscription_plan.update',
          entityType: 'SubscriptionPlan',
          entityId: planId,
          previousValue: existing,
          newValue: input,
        });
        return plan;
      });
    } catch (error) {
      throw this.translateDbError(error);
    }
  }

  /**
   * Plans are never hard-deleted — active subscriptions reference them via
   * a non-cascading FK (`onDelete: Restrict` in schema.prisma), and history
   * (past invoices) must keep displaying the plan name/price as it was.
   * "Deleting" a plan means archiving it (removed from the restaurant-owner
   * checkout list, existing subscribers unaffected).
   */
  static async archive(planId: string, platformAdminId: string) {
    return this.update(planId, { status: 'ARCHIVED' }, platformAdminId);
  }

  private static translateDbError(error: unknown): unknown {
    if (error instanceof Error && error.message.includes('subscription_plans_planCode_key')) {
      return new ConflictError('A subscription plan with this plan code already exists.');
    }
    return error;
  }
}
