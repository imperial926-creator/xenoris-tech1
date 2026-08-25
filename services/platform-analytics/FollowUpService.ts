import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { ActionCenterService, TASK_TYPES, type TaskType } from '@/services/platform-billing/ActionCenterService';

/**
 * Master Data Analytics spec's "Follow-Up Management" system (ADMIN →
 * FOLLOW-UPS, from the spec's own separate document): payment issues,
 * renewals, upgrade opportunities, downgrade risk, sales, onboarding,
 * inactive accounts. Implemented as a FILTERED VIEW over the same
 * `ActionCenterTask` table (see the Phase 18 header comment in
 * schema.prisma) rather than a second parallel task table.
 *
 * The spec's own follow-up status vocabulary (NEW/CONTACTED/
 * WAITING_FOR_RESPONSE/FOLLOW_UP_REQUIRED/RESOLVED/CONVERTED/
 * NOT_INTERESTED/NO_RESPONSE/CLOSED) is richer, in follow-up-specific ways,
 * than the general `ActionCenterTaskStatus` enum every OTHER task type
 * shares (a technical incident has no "CONVERTED" state). Rather than
 * bloating that shared enum with follow-up-only concepts,
 * `recordOutcome()` translates a follow-up outcome into the closest
 * underlying `ActionCenterTaskStatus` + a `resolutionNotes` annotation
 * that preserves the specific outcome for display:
 *
 *   CONTACTED            -> IN_PROGRESS   (+ a note)
 *   WAITING_FOR_RESPONSE -> WAITING
 *   FOLLOW_UP_REQUIRED   -> FOLLOW_UP_REQUIRED
 *   CONVERTED            -> RESOLVED      (resolutionNotes: "Converted")
 *   RESOLVED             -> RESOLVED
 *   NOT_INTERESTED        -> DISMISSED
 *   NO_RESPONSE           -> CLOSED       (resolutionNotes: "No response")
 *   CLOSED                -> CLOSED
 */
export const FOLLOW_UP_TASK_TYPES: TaskType[] = [
  TASK_TYPES.SUBSCRIPTION_RENEWAL,
  TASK_TYPES.UPGRADE_OPPORTUNITY,
  TASK_TYPES.DOWNGRADE_RISK,
  TASK_TYPES.SALES_FOLLOW_UP,
  TASK_TYPES.ONBOARDING_INCOMPLETE,
  TASK_TYPES.INACTIVE_RESTAURANT,
  TASK_TYPES.FAILED_PAYMENT,
  TASK_TYPES.REPEATED_FAILED_PAYMENT,
];

export type FollowUpOutcome =
  | 'CONTACTED'
  | 'WAITING_FOR_RESPONSE'
  | 'FOLLOW_UP_REQUIRED'
  | 'CONVERTED'
  | 'RESOLVED'
  | 'NOT_INTERESTED'
  | 'NO_RESPONSE'
  | 'CLOSED';

const OUTCOME_MAP: Record<FollowUpOutcome, { status: Parameters<typeof ActionCenterService.updateStatus>[1]; note: string }> = {
  CONTACTED: { status: 'IN_PROGRESS', note: 'Contacted' },
  WAITING_FOR_RESPONSE: { status: 'WAITING', note: 'Waiting for response' },
  FOLLOW_UP_REQUIRED: { status: 'FOLLOW_UP_REQUIRED', note: 'Follow-up required' },
  CONVERTED: { status: 'RESOLVED', note: 'Converted' },
  RESOLVED: { status: 'RESOLVED', note: 'Resolved' },
  NOT_INTERESTED: { status: 'DISMISSED', note: 'Not interested' },
  NO_RESPONSE: { status: 'CLOSED', note: 'No response' },
  CLOSED: { status: 'CLOSED', note: 'Closed' },
};

export class FollowUpService {
  static async list(params: { type?: TaskType; assignedToAdminId?: string; limit?: number }) {
    return ActionCenterService.list({
      type: params.type,
      assignedToAdminId: params.assignedToAdminId,
      limit: params.limit,
    }).then((tasks) => tasks.filter((t) => FOLLOW_UP_TASK_TYPES.includes(t.type as TaskType)));
  }

  static async recordOutcome(taskId: string, outcome: FollowUpOutcome, actingAdminId: string, note?: string) {
    const mapped = OUTCOME_MAP[outcome];
    const task = await ActionCenterService.updateStatus(taskId, mapped.status, actingAdminId, note ?? mapped.note);
    if (note) {
      await ActionCenterService.addNote(taskId, actingAdminId, `${mapped.note}: ${note}`);
    }
    return task;
  }

  /** Master spec's configurable renewal follow-up schedule (30/14/7/3-day-before + payment-day). */
  static async upcomingRenewals(daysAhead: number) {
    const cutoff = new Date(Date.now() + daysAhead * 86_400_000);
    return prisma.subscription.findMany({
      where: { status: 'ACTIVE', nextBillingDate: { lte: cutoff, gte: new Date() } },
      include: { organization: { select: { id: true, name: true } }, plan: true },
      orderBy: { nextBillingDate: 'asc' },
    });
  }

  /**
   * Generates/refreshes renewal follow-up tasks for subscriptions renewing
   * within the configured reminder windows. Request-triggered (called from
   * the Follow-Ups dashboard and the cron route) — no in-process scheduler
   * exists in this codebase, same documented limitation as
   * `SubscriptionRetryService.runDueRetries`.
   */
  static async generateRenewalFollowUps(reminderDays: number[]) {
    let created = 0;
    for (const days of reminderDays) {
      const windowStart = new Date(Date.now() + (days - 0.5) * 86_400_000);
      const windowEnd = new Date(Date.now() + (days + 0.5) * 86_400_000);
      const subs = await prisma.subscription.findMany({
        where: { status: 'ACTIVE', nextBillingDate: { gte: windowStart, lte: windowEnd } },
        include: { organization: { select: { id: true, name: true } }, plan: true },
      });
      for (const sub of subs) {
        const priority = days <= 3 ? 'HIGH' : days <= 14 ? 'MEDIUM' : 'LOW';
        await ActionCenterService.createTask(prisma, {
          type: TASK_TYPES.SUBSCRIPTION_RENEWAL,
          title: `${sub.organization.name} — ${sub.plan.name} renewal in ${days} day(s)`,
          priority,
          organizationId: sub.organizationId,
          subscriptionId: sub.id,
          sourceModule: 'renewals',
          dueAt: sub.nextBillingDate ?? undefined,
        });
        created += 1;
      }
    }
    return { created };
  }
}
