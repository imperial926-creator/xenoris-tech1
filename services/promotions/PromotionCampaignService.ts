import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { emitRealtimeEvent, writeCustomerNotification } from '@/lib/realtime/emit';
import { PromotionService } from '@/services/promotions/PromotionService';
import { resolveAudience } from '@/services/promotions/AudienceResolver';
import { resolveCustomerNotificationSettings } from '@/lib/notifications/customer-app-settings';
import { log } from '@/lib/monitoring/logger';
import type { CampaignStatus, NotificationDeliveryChannel, Prisma } from '@prisma/client';
import type { CreateCampaignInput, ListCampaignsQueryInput, UpdateCampaignInput } from '@/lib/validation/promotion';

/**
 * CAPP Phase 8 — spec § 28 "Promotional campaign management" / § 33
 * "Notification queue" architecture diagram (Restaurant creates campaign ->
 * Campaign service -> Audience calculation -> Notification queue -> Push/
 * email/SMS workers -> Customer). This class owns exactly the first three
 * boxes of that diagram: campaign CRUD and audience calculation
 * (`send`, which resolves+materializes the audience into `CampaignAudience`
 * rows). The last two boxes — an actual notification queue and
 * push/email/SMS workers — are CAPP Phase 9's job (spec § 33 itself is
 * listed under the phased plan's Phase 9 scope, not this one); `send` here
 * marks "who is eligible and was recorded as targeted," not "was actually
 * notified." See architecture.md § 17 for the full reasoning, including why
 * that's a defensible line rather than a shortcut.
 */
const ALLOWED_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ['SCHEDULED', 'ACTIVE', 'CANCELLED'],
  SCHEDULED: ['ACTIVE', 'PAUSED', 'CANCELLED'],
  ACTIVE: ['PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['ACTIVE', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export class PromotionCampaignService {
  static async list(organizationId: string, query: ListCampaignsQueryInput) {
    return prisma.promotionCampaign.findMany({
      where: { organizationId, status: query.status, promotionId: query.promotionId },
      include: { promotion: { select: { id: true, title: true } }, _count: { select: { audience: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
    });
  }

  static async get(organizationId: string, campaignId: string) {
    const campaign = await prisma.promotionCampaign.findFirst({
      where: { id: campaignId, organizationId },
      include: { promotion: { select: { id: true, title: true } }, audience: { take: 200 } },
    });
    if (!campaign) throw new NotFoundError('Campaign');
    return campaign;
  }

  static async create(organizationId: string, input: CreateCampaignInput, actorUserId: string) {
    await PromotionService.get(organizationId, input.promotionId);
    this.assertAudienceParams(input.audienceType, input.audienceParams);

    const campaign = await prisma.promotionCampaign.create({
      data: {
        organizationId,
        promotionId: input.promotionId,
        name: input.name,
        audienceType: input.audienceType,
        audienceParams: (input.audienceParams ?? undefined) as Prisma.InputJsonValue | undefined,
        scheduledAt: input.scheduledAt ? this.parseDate(input.scheduledAt) : undefined,
        status: input.scheduledAt ? 'SCHEDULED' : 'DRAFT',
      },
    });
    await writeAuditLog(prisma, { organizationId, userId: actorUserId, action: 'campaign.create', entityType: 'PromotionCampaign', entityId: campaign.id, newValue: campaign });
    if (campaign.status === 'SCHEDULED') {
      await emitRealtimeEvent(prisma, { organizationId, type: 'CampaignScheduled', payload: { campaignId: campaign.id, promotionId: campaign.promotionId, scheduledAt: campaign.scheduledAt } });
    }
    return campaign;
  }

  static async update(organizationId: string, campaignId: string, input: UpdateCampaignInput, actorUserId: string) {
    const existing = await this.get(organizationId, campaignId);
    if (existing.status !== 'DRAFT' && existing.status !== 'SCHEDULED') {
      throw new ConflictError('Only a DRAFT or SCHEDULED campaign can be edited.');
    }
    if (input.audienceType) this.assertAudienceParams(input.audienceType, input.audienceParams ?? existing.audienceParams as Record<string, unknown> | null);

    const campaign = await prisma.promotionCampaign.update({
      where: { id: campaignId },
      data: {
        name: input.name,
        audienceType: input.audienceType,
        audienceParams: input.audienceParams as Prisma.InputJsonValue | undefined,
        scheduledAt: input.scheduledAt ? this.parseDate(input.scheduledAt) : undefined,
      },
    });
    await writeAuditLog(prisma, { organizationId, userId: actorUserId, action: 'campaign.update', entityType: 'PromotionCampaign', entityId: campaignId, previousValue: existing, newValue: campaign });
    return campaign;
  }

  static async updateStatus(organizationId: string, campaignId: string, status: CampaignStatus, actorUserId: string) {
    const existing = await this.get(organizationId, campaignId);
    if (existing.status === status) return existing;
    // `?? []` guards noUncheckedIndexedAccess, same reasoning as
    // AudienceResolver.resolveAudience's resolver lookup — CampaignStatus
    // is a closed enum with every key present in ALLOWED_TRANSITIONS, this
    // is unreachable in practice.
    if (!(ALLOWED_TRANSITIONS[existing.status] ?? []).includes(status)) {
      throw new ConflictError(`Cannot move a campaign from ${existing.status} to ${status}.`);
    }
    const campaign = await prisma.promotionCampaign.update({ where: { id: campaignId }, data: { status } });
    await writeAuditLog(prisma, { organizationId, userId: actorUserId, action: 'campaign.status', entityType: 'PromotionCampaign', entityId: campaignId, previousValue: { status: existing.status }, newValue: { status } });
    return campaign;
  }

  /**
   * Preview-only: resolves the audience without writing `CampaignAudience`
   * rows or changing status — spec § 19's "The system should generate the
   * eligible audience automatically," surfaced as a dry-run a restaurant can
   * call repeatedly while tuning `audienceParams` before committing to
   * `send`.
   */
  static async previewAudience(organizationId: string, campaignId: string) {
    const campaign = await this.get(organizationId, campaignId);
    const members = await resolveAudience(organizationId, campaign.audienceType, campaign.audienceParams as Record<string, unknown> | null);
    return { count: members.length, sample: members.slice(0, 20) };
  }

  /**
   * Resolves and *materializes* the audience (writes `CampaignAudience`
   * rows — architecture.md § 5's "auditable who was actually eligible, not
   * recomputed after the fact"), marks the campaign ACTIVE/sent, and — CAPP
   * Phase 9 — completes spec § 33's remaining two boxes: writes a
   * `CustomerNotification` (spec § 27) plus its per-channel
   * `NotificationDelivery` rows (spec § 34) for every eligible, opted-in
   * member. What still doesn't happen here is the actual PUSH/EMAIL/SMS
   * provider call — only IN_APP is "delivered" synchronously (that's just a
   * DB row, no external system involved); the other channels are queued for
   * `NotificationDispatchService.dispatchQueued`, which this build has no
   * scheduler to invoke automatically. See architecture.md § 18 for the
   * full reasoning on why that split is the honest line, not a shortcut.
   *
   * Anti-spam (spec § 51): opt-out is already enforced upstream by
   * `resolveAudience` (org-level `marketingOptIn`/`allowPromotional`); this
   * method additionally checks each member's per-channel preference
   * (`pushPromotions`/`emailPromotions`/`smsPromotions` — a channel a
   * customer disabled gets an `UNSUBSCRIBED` delivery row, not a queued
   * one) and a rolling frequency-limit window (a member who already got a
   * promotional notification recently has PUSH/EMAIL/SMS suppressed for
   * this send, but still gets the in-app entry — see
   * `findThrottledAccountIds`). Duplicate-prevention ("same campaign, same
   * customer, at most once") is structural:
   * `CustomerNotification.@@unique([campaignId, customerAccountId])` plus
   * `send` itself only being callable from DRAFT/SCHEDULED, so a campaign
   * can never be sent twice.
   */
  static async send(organizationId: string, campaignId: string, actorUserId: string) {
    const existing = await this.get(organizationId, campaignId);
    if (existing.status !== 'DRAFT' && existing.status !== 'SCHEDULED') {
      throw new ConflictError('Only a DRAFT or SCHEDULED campaign can be sent.');
    }

    const members = await resolveAudience(organizationId, existing.audienceType, existing.audienceParams as Record<string, unknown> | null);
    const accountIds = members.map((m) => m.customerAccountId);

    const org = accountIds.length === 0 ? null : await prisma.organization.findUnique({ where: { id: organizationId }, select: { customerAppSettings: true } });
    const settings = resolveCustomerNotificationSettings(org?.customerAppSettings ?? null);

    // Explicitly typed + assigned via an if-branch rather than a ternary
    // between `[]` and `Promise.all(...)` — the ternary shape previously
    // here left `preferences`' element type under-specified without
    // `@prisma/client`'s generated types in this sandbox (no node_modules),
    // which this annotation pins down independently of that.
    let preferences: Array<{ customerAccountId: string; pushPromotions: boolean; emailPromotions: boolean; smsPromotions: boolean }> = [];
    let throttledIds = new Set<string>();
    if (accountIds.length > 0) {
      [preferences, throttledIds] = await Promise.all([
        prisma.customerNotificationPreference.findMany({ where: { customerAccountId: { in: accountIds } } }),
        this.findThrottledAccountIds(accountIds, settings.promotionalFrequencyLimitHours),
      ]);
    }
    const preferenceByAccount = new Map(preferences.map((p) => [p.customerAccountId, p]));

    if (throttledIds.size > 0) {
      log.info('CAPP Phase 9: promotional frequency limit suppressed outbound channels for some recipients', {
        campaignId,
        throttledCount: throttledIds.size,
        windowHours: settings.promotionalFrequencyLimitHours,
      });
    }

    const campaign = await prisma.$transaction(async (tx) => {
      if (members.length > 0) {
        await tx.campaignAudience.createMany({
          data: members.map((m) => ({ campaignId, customerAccountId: m.customerAccountId, eligibilityReason: m.reason })),
          skipDuplicates: true,
        });
      }

      // CAPP Phase 12 hardening (performance audit) — this loop is still
      // O(members) DB round trips for the `writeCustomerNotification` half,
      // and that part genuinely can't be batched away: each recipient needs
      // their *own* `CustomerNotification` row and their *own*
      // `NotificationCreated` realtime emit (see writeCustomerNotification's
      // own header — it's what makes this a *personal* event, not a
      // broadcast one), and this build has no queue/worker infrastructure to
      // move that fan-out off the request path onto (spec § 33's "Push/
      // email/SMS workers" box was scoped to Phase 9's *dispatch* step, not
      // to campaign `send`'s own audience fan-out). What WAS a real,
      // fixable N+1 — `AudienceResolver` calling `CustomerService.getAnalytics`
      // per candidate before this transaction even opened — is fixed via
      // `CustomerService.getRfmBatch` (see AudienceResolver.bySegment's own
      // comment); what remains here is reduced from 2 DB writes/member to 1
      // by collecting every member's delivery rows and inserting them in a
      // single `createMany` after the loop, instead of one `createMany` call
      // per member.
      const deliveryRows: Array<{
        customerNotificationId: string;
        channel: NotificationDeliveryChannel;
        status: 'DELIVERED' | 'QUEUED' | 'UNSUBSCRIBED';
        sentAt?: Date;
        deliveredAt?: Date;
      }> = [];
      for (const member of members) {
        const preference = preferenceByAccount.get(member.customerAccountId);
        const created = await writeCustomerNotification(
          tx,
          organizationId,
          member.customerAccountId,
          {
            category: 'PROMOTION',
            title: existing.promotion.title,
            message: `${existing.promotion.title} — check it out in Promotions.`,
            deepLink: 'Promotions',
            relatedEntityType: 'Promotion',
            relatedEntityId: existing.promotionId,
          },
          campaignId,
        );

        const now = new Date();
        deliveryRows.push({ customerNotificationId: created.id, channel: 'IN_APP', status: 'DELIVERED', sentAt: now, deliveredAt: now });
        const channelAllowed = {
          PUSH: preference?.pushPromotions ?? true,
          EMAIL: preference?.emailPromotions ?? true,
          SMS: preference?.smsPromotions ?? false,
        } as const;
        const isThrottled = throttledIds.has(member.customerAccountId);
        (['PUSH', 'EMAIL', 'SMS'] as const).forEach((channel) => {
          if (!channelAllowed[channel]) {
            deliveryRows.push({ customerNotificationId: created.id, channel, status: 'UNSUBSCRIBED' });
          } else if (!isThrottled) {
            deliveryRows.push({ customerNotificationId: created.id, channel, status: 'QUEUED' });
          }
          // Throttled + otherwise-allowed: intentionally no row at all this
          // send — see this method's own header for why that's the chosen
          // "skip silently for this send, keep the in-app record" shape.
        });
      }
      if (deliveryRows.length > 0) {
        await tx.notificationDelivery.createMany({ data: deliveryRows });
      }

      const updated = await tx.promotionCampaign.update({ where: { id: campaignId }, data: { status: 'ACTIVE', sentAt: new Date() } });
      await writeAuditLog(tx, { organizationId, userId: actorUserId, action: 'campaign.send', entityType: 'PromotionCampaign', entityId: campaignId, newValue: { audienceSize: members.length } });
      await emitRealtimeEvent(tx, { organizationId, type: 'CampaignSent', payload: { campaignId, promotionId: existing.promotionId, audienceSize: members.length } });
      return updated;
    }, {
      // CAPP Phase 12 hardening (performance audit): Prisma's default
      // interactive-transaction timeout is 5s. This transaction's own
      // duration scales with audience size (2 writes/member — see the loop
      // comment above), so a large-but-plausible audience (low thousands)
      // could plausibly exceed the default and abort an otherwise-healthy
      // send. Widened defensively; does not by itself fix the underlying
      // "still runs on the request path" limitation documented above.
      timeout: 30_000,
    });
    return { campaign, audienceSize: members.length };
  }

  /**
   * Spec § 51 "Frequency limits": accounts that already received a
   * PROMOTION-category, campaign-originated notification within the
   * configured rolling window. One query for the whole send, not one per
   * member — `CustomerNotification` already carries
   * `customerAccountId`/`category`/`campaignId`/`createdAt`, no join needed.
   */
  private static async findThrottledAccountIds(accountIds: string[], windowHours: number): Promise<Set<string>> {
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const recent = await prisma.customerNotification.findMany({
      where: { customerAccountId: { in: accountIds }, category: 'PROMOTION', campaignId: { not: null }, createdAt: { gte: cutoff } },
      select: { customerAccountId: true },
      distinct: ['customerAccountId'],
    });
    return new Set(recent.map((r) => r.customerAccountId));
  }

  // --- helpers ---------------------------------------------------------------

  /** Cross-checks that an audience type requiring parameters actually has them — see AudienceResolver.ts's own per-type comments for exactly what each expects. */
  private static assertAudienceParams(audienceType: string, params: Record<string, unknown> | null | undefined): void {
    const requiresParams: Record<string, string> = {
      INACTIVE_DAYS: 'days',
      ORDERED_ITEMS: 'menuItemIds',
      LOCATION: 'query',
      SEGMENT: 'segment',
    };
    const requiredKey = requiresParams[audienceType];
    if (requiredKey && (!params || params[requiredKey] === undefined)) {
      throw new ConflictError(`audienceType ${audienceType} requires audienceParams.${requiredKey}.`);
    }
  }

  private static parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ConflictError('scheduledAt is not a valid date.');
    return date;
  }
}
