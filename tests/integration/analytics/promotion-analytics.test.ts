import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { MenuService } from '@/services/menu/MenuService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { CustomerOrderService } from '@/services/customer/CustomerOrderService';
import { OrderService } from '@/services/orders/OrderService';
import { PromotionService } from '@/services/promotions/PromotionService';
import { PromotionAnalyticsService } from '@/services/promotions/PromotionAnalyticsService';
import { NotFoundError } from '@/lib/utils/api-error';
import { resetDatabase } from '../../helpers/db';

/**
 * CAPP Phase 12 hardening — the master spec's own "Do not fake promotional
 * analytics" instruction had no test coverage through CAPP Phase 11. These
 * assert the two things that instruction actually demands: real numbers
 * computed from real redemption data (not made up), and an honest
 * `dataGaps` list for whatever this platform genuinely can't measure yet —
 * rather than silently reporting `0` for something untracked and letting it
 * read as "verified zero."
 */

async function setupOrgWithMenu(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Promo Analytics Test ${suffix}`,
    organizationEmail: `promo-analytics-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@promo-analytics-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  const branch = await BranchService.create(user.organizationId, { name: `Branch ${suffix}`, timezone: 'Asia/Manila' }, user.id);
  const category = await MenuService.createCategory(user.organizationId, { name: 'Mains', displayOrder: 0 }, user.id);
  const item = await MenuService.createItem(
    user.organizationId,
    { categoryId: category.id, name: 'Burger', price: '150.00', available: true, taxCategory: 'STANDARD' },
    user.id,
  );
  const orgRow = await prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
  return { user, branch, item, publicCode: orgRow.publicCode! };
}

/** Walks a freshly-placed order through every staff-side status to COMPLETED — `PromotionAnalyticsService`'s `revenueGenerated` only counts COMPLETED orders (see that method's own comment), so a test asserting real revenue numbers needs a genuinely completed order, not a PENDING one. */
async function completeOrder(organizationId: string, branchId: string, orderId: string, actorUserId: string) {
  for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'] as const) {
    await OrderService.updateStatus(organizationId, branchId, orderId, { status }, actorUserId);
  }
}

async function registerDiner(suffix: string) {
  const result = await CustomerAccountService.register(
    {
      email: `diner-analytics-${suffix}@example.com`,
      password: 'SuperSecret123!',
      firstName: 'Dina',
      lastName: 'Diner',
      marketingOptIn: false,
      acceptedTerms: true,
      acceptedPrivacy: true,
    },
    {},
  );
  return result.customer.id;
}

function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

describe('PromotionAnalyticsService — honest reporting', () => {
  beforeAll(() => {
    process.env.CUSTOMER_AUTH_SECRET =
      'test-customer-secret-do-not-use-in-production-hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh';
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('computes promotionRevenue/discountGiven/estimatedRoi from a real redemption, not a placeholder', async () => {
    const { user, branch, item, publicCode } = await setupOrgWithMenu('real-numbers');
    const diner = await registerDiner('real-numbers');

    const promotion = await PromotionService.create(
      user.organizationId,
      {
        title: 'Ten Off',
        promoCode: 'TENOFF',
        discountType: 'FIXED_AMOUNT',
        discountValue: '10.00',
        startAt: hoursFromNow(-1),
        eligibleServices: [],
        eligibleMenuItemIds: [],
        eligibleCategoryIds: [],
      },
      user.id,
    );
    await PromotionService.updateStatus(user.organizationId, promotion.id, 'ACTIVE', user.id);

    const order = await CustomerOrderService.createOrder(publicCode, diner, {
      type: 'TAKEOUT',
      items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
      pickupTime: hoursFromNow(2),
      paymentMethod: 'CASH',
      promoCode: 'TENOFF',
    });
    await completeOrder(user.organizationId, branch.id, order.id, user.id);

    const analytics = await PromotionAnalyticsService.getPromotionAnalytics(user.organizationId, promotion.id);

    // 1 order, 150.00 subtotal, 10.00 discount, no delivery fee — the
    // revenue/cost figures must reflect that exact math, not a canned value.
    expect(analytics.discountGiven).toBe('10.00');
    expect(analytics.promotionRevenue).toBe('140.00');
    expect(analytics.ordersGenerated).toBe(1);
    expect(analytics.customersConverted).toBe(1);
    // (140 - 10) / 10 = 13
    expect(analytics.estimatedRoi).toBeCloseTo(13, 5);
  });

  it('reports untrackable metrics as flagged data gaps, not fabricated zeros passed off as verified', async () => {
    const { user, item, publicCode } = await setupOrgWithMenu('data-gaps');
    const diner = await registerDiner('data-gaps');

    const promotion = await PromotionService.create(
      user.organizationId,
      {
        title: 'Data Gaps Promo',
        promoCode: 'GAPS10',
        discountType: 'FIXED_AMOUNT',
        discountValue: '10.00',
        startAt: hoursFromNow(-1),
        eligibleServices: [],
        eligibleMenuItemIds: [],
        eligibleCategoryIds: [],
      },
      user.id,
    );
    await PromotionService.updateStatus(user.organizationId, promotion.id, 'ACTIVE', user.id);
    await CustomerOrderService.createOrder(publicCode, diner, {
      type: 'TAKEOUT',
      items: [{ menuItemId: item.id, quantity: 1, modifierIds: [] }],
      pickupTime: hoursFromNow(2),
      paymentMethod: 'CASH',
      promoCode: 'GAPS10',
    });

    const analytics = await PromotionAnalyticsService.getPromotionAnalytics(user.organizationId, promotion.id);

    // This build has never wired reservation/catering redemption — these
    // must read as 0 AND be named in dataGaps, not just silently 0.
    expect(analytics.funnel.reservationsGenerated).toBe(0);
    expect(analytics.funnel.cateringInquiriesGenerated).toBe(0);
    expect(analytics.dataGaps.length).toBeGreaterThan(0);
    expect(analytics.dataGaps.some((gap) => gap.includes('reservationsGenerated'))).toBe(true);

    const attribution = await PromotionAnalyticsService.getSalesAttribution(user.organizationId, { preset: 'this_month' });
    // No payment gateway/refund workflow exists on this platform — these
    // must be null (honestly "unknown"), never a fabricated 0.
    expect(attribution.refunds).toBeNull();
    expect(attribution.paymentFeesAvailable).toBeNull();
    expect(attribution.dataGaps.some((gap) => gap.includes('refunds'))).toBe(true);
    expect(attribution.dataGaps.some((gap) => gap.includes('paymentFeesAvailable'))).toBe(true);
  });

  it('never lets a promotion analytics query cross into another restaurant\'s promotion', async () => {
    const orgA = await setupOrgWithMenu('analytics-cross-a');
    const orgB = await setupOrgWithMenu('analytics-cross-b');
    const promoA = await PromotionService.create(
      orgA.user.organizationId,
      {
        title: 'Org A Promo',
        discountType: 'FIXED_AMOUNT',
        discountValue: '10.00',
        startAt: hoursFromNow(-1),
        eligibleServices: [],
        eligibleMenuItemIds: [],
        eligibleCategoryIds: [],
      },
      orgA.user.id,
    );

    await expect(PromotionAnalyticsService.getPromotionAnalytics(orgB.user.organizationId, promoA.id)).rejects.toThrow(NotFoundError);
  });
});
