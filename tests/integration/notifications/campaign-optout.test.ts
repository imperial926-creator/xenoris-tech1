import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { CustomerNotificationService } from '@/services/customer/CustomerNotificationService';
import { PromotionService } from '@/services/promotions/PromotionService';
import { PromotionCampaignService } from '@/services/promotions/PromotionCampaignService';
import { resetDatabase } from '../../helpers/db';

/**
 * CAPP Phase 12 hardening — the master spec's own "Do not send promotional
 * notifications to customers who have opted out" instruction (spec § 26,
 * § 51) had no test coverage through CAPP Phases 8-9, even though the
 * security audit for this phase re-verified the enforcement logic by
 * reading the code. This locks that behavior in via the actual
 * `PromotionCampaignService.send` path, not by re-reading source.
 */

async function setupOrgWithActivePromo(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Campaign Optout Test ${suffix}`,
    organizationEmail: `campaign-optout-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@campaign-optout-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  await BranchService.create(user.organizationId, { name: `Branch ${suffix}`, timezone: 'Asia/Manila' }, user.id);
  const promotion = await PromotionService.create(
    user.organizationId,
    {
      title: 'Weekend Special',
      discountType: 'FIXED_AMOUNT',
      discountValue: '20.00',
      startAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      eligibleServices: [],
      eligibleMenuItemIds: [],
      eligibleCategoryIds: [],
    },
    user.id,
  );
  await PromotionService.updateStatus(user.organizationId, promotion.id, 'ACTIVE', user.id);
  return { user, promotion };
}

async function registerDiner(suffix: string, marketingOptIn: boolean) {
  const result = await CustomerAccountService.register(
    {
      email: `diner-optout-${suffix}@example.com`,
      password: 'SuperSecret123!',
      firstName: 'Dina',
      lastName: 'Diner',
      marketingOptIn,
      acceptedTerms: true,
      acceptedPrivacy: true,
    },
    {},
  );
  return result.customer.id;
}

describe('Campaign notification opt-out enforcement', () => {
  beforeAll(() => {
    process.env.CUSTOMER_AUTH_SECRET =
      'test-customer-secret-do-not-use-in-production-ffffffffffffffffffffffffffffffff';
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('excludes an account-level opted-out diner from the audience entirely — zero notification rows of any kind', async () => {
    const { user, promotion } = await setupOrgWithActivePromo('account-optout');
    const optedOut = await registerDiner('account-optout-optedout', false);
    const optedIn = await registerDiner('account-optout-optedin', true);

    const campaign = await PromotionCampaignService.create(
      user.organizationId,
      { promotionId: promotion.id, name: 'Weekend Blast', audienceType: 'ALL' },
      user.id,
    );
    const { audienceSize } = await PromotionCampaignService.send(user.organizationId, campaign.id, user.id);

    // Only the opted-in diner should have been targeted at all.
    expect(audienceSize).toBe(1);

    const optedOutNotifications = await prisma.customerNotification.findMany({ where: { customerAccountId: optedOut } });
    expect(optedOutNotifications).toHaveLength(0);

    const optedInNotifications = await prisma.customerNotification.findMany({ where: { customerAccountId: optedIn } });
    expect(optedInNotifications).toHaveLength(1);
  });

  it('respects per-channel preferences: a disabled channel gets an UNSUBSCRIBED delivery row, never a QUEUED one', async () => {
    const { user, promotion } = await setupOrgWithActivePromo('channel-prefs');
    const dinerAccountId = await registerDiner('channel-prefs', true);
    await CustomerNotificationService.updatePreferences(dinerAccountId, { pushPromotions: false });

    const campaign = await PromotionCampaignService.create(
      user.organizationId,
      { promotionId: promotion.id, name: 'Channel Prefs Blast', audienceType: 'ALL' },
      user.id,
    );
    await PromotionCampaignService.send(user.organizationId, campaign.id, user.id);

    const notification = await prisma.customerNotification.findFirstOrThrow({ where: { customerAccountId: dinerAccountId } });
    const deliveries = await prisma.notificationDelivery.findMany({ where: { customerNotificationId: notification.id } });
    const byChannel = Object.fromEntries(deliveries.map((d) => [d.channel, d.status]));

    expect(byChannel.IN_APP).toBe('DELIVERED');
    // Explicitly disabled — must be UNSUBSCRIBED, never QUEUED.
    expect(byChannel.PUSH).toBe('UNSUBSCRIBED');
    // Left at its default (emailPromotions: true) — should still be queued.
    expect(byChannel.EMAIL).toBe('QUEUED');
    // smsPromotions defaults to false even with no preference override.
    expect(byChannel.SMS).toBe('UNSUBSCRIBED');
  });

  it('a diner who opts out AFTER a campaign was already sent does not retroactively lose the already-delivered IN_APP row', async () => {
    const { user, promotion } = await setupOrgWithActivePromo('post-send-optout');
    const dinerAccountId = await registerDiner('post-send-optout', true);

    const campaign = await PromotionCampaignService.create(
      user.organizationId,
      { promotionId: promotion.id, name: 'Before Optout Blast', audienceType: 'ALL' },
      user.id,
    );
    await PromotionCampaignService.send(user.organizationId, campaign.id, user.id);

    await CustomerNotificationService.updatePreferences(dinerAccountId, { allowPromotional: false });

    const notification = await prisma.customerNotification.findFirstOrThrow({ where: { customerAccountId: dinerAccountId } });
    const inAppDelivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { customerNotificationId: notification.id, channel: 'IN_APP' },
    });
    expect(inAppDelivery.status).toBe('DELIVERED');
  });
});
