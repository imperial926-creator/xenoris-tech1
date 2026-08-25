import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { MenuService } from '@/services/menu/MenuService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { CustomerOrderService } from '@/services/customer/CustomerOrderService';
import { PromotionService } from '@/services/promotions/PromotionService';
import { CustomerPromotionService } from '@/services/customer/CustomerPromotionService';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { resetDatabase } from '../../helpers/db';

/**
 * CAPP Phase 12 hardening — spec § 25 "Promotion redemption" and the master
 * spec's own "Do not allow duplicate promotions to be redeemed" / "Do not
 * allow cross-restaurant data access" instructions had no test coverage at
 * all through CAPP Phases 8-11 (this whole `tests/integration/promotions/`
 * directory didn't exist before this phase). These exercise the two limits
 * `PromotionService.recordRedemption` enforces (organization-wide
 * `usageLimit`, per-customer `customerUsageLimit`) end-to-end through the
 * same `CustomerOrderService.createOrder` path a real checkout uses — not by
 * calling `recordRedemption` directly — so a regression in
 * `OrderService.createOrder`'s own promo wiring would also be caught here,
 * not just a unit-level regression in PromotionService itself.
 */

async function setupOrgWithMenu(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Promo Redemption Test ${suffix}`,
    organizationEmail: `promo-redemption-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@promo-redemption-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  await BranchService.create(user.organizationId, { name: `Branch ${suffix}`, timezone: 'Asia/Manila' }, user.id);
  const category = await MenuService.createCategory(user.organizationId, { name: 'Mains', displayOrder: 0 }, user.id);
  const item = await MenuService.createItem(
    user.organizationId,
    { categoryId: category.id, name: 'Burger', price: '150.00', available: true, taxCategory: 'STANDARD' },
    user.id,
  );
  const orgRow = await prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
  return { user, item, publicCode: orgRow.publicCode! };
}

async function registerDiner(suffix: string) {
  const result = await CustomerAccountService.register(
    {
      email: `diner-promo-${suffix}@example.com`,
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

/** Creates and activates a FIXED_AMOUNT promo code with no eligibility restrictions beyond the two usage limits under test. */
async function createActivePromo(
  organizationId: string,
  actorUserId: string,
  promoCode: string,
  limits: { usageLimit?: number; customerUsageLimit?: number },
) {
  const promotion = await PromotionService.create(
    organizationId,
    {
      title: `Promo ${promoCode}`,
      promoCode,
      discountType: 'FIXED_AMOUNT',
      discountValue: '20.00',
      startAt: hoursFromNow(-1),
      eligibleServices: [],
      eligibleMenuItemIds: [],
      eligibleCategoryIds: [],
      ...limits,
    },
    actorUserId,
  );
  return PromotionService.updateStatus(organizationId, promotion.id, 'ACTIVE', actorUserId);
}

async function placeTakeoutOrder(publicCode: string, customerAccountId: string, menuItemId: string, promoCode: string) {
  return CustomerOrderService.createOrder(publicCode, customerAccountId, {
    type: 'TAKEOUT',
    items: [{ menuItemId, quantity: 1, modifierIds: [] }],
    pickupTime: hoursFromNow(2),
    paymentMethod: 'CASH',
    promoCode,
  });
}

describe('Promotion redemption limits', () => {
  beforeAll(() => {
    process.env.CUSTOMER_AUTH_SECRET =
      'test-customer-secret-do-not-use-in-production-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('enforces the organization-wide usageLimit across different customers, never letting redemptionCount exceed it', async () => {
    const { user, item, publicCode } = await setupOrgWithMenu('usage-limit');
    await createActivePromo(user.organizationId, user.id, 'ONEUSE', { usageLimit: 1 });

    const dinerA = await registerDiner('usage-limit-a');
    const dinerB = await registerDiner('usage-limit-b');

    const firstOrder = await placeTakeoutOrder(publicCode, dinerA, item.id, 'ONEUSE');
    expect(firstOrder.discountTotal.toString()).toBe('20.00');

    // Second redemption, by a *different* customer, must be rejected once
    // the org-wide limit is spent — this is the "Do not allow duplicate
    // promotions to be redeemed" instruction, not just a per-customer check.
    await expect(placeTakeoutOrder(publicCode, dinerB, item.id, 'ONEUSE')).rejects.toThrow(ConflictError);

    const promotion = await prisma.promotion.findFirstOrThrow({ where: { organizationId: user.organizationId, promoCode: 'ONEUSE' } });
    expect(promotion.redemptionCount).toBe(1);
    const redemptions = await prisma.promotionRedemption.count({ where: { promotionId: promotion.id } });
    expect(redemptions).toBe(1);
  });

  it('enforces customerUsageLimit per diner while still allowing a different diner to redeem', async () => {
    const { user, item, publicCode } = await setupOrgWithMenu('customer-limit');
    await createActivePromo(user.organizationId, user.id, 'ONCEEACH', { customerUsageLimit: 1 });

    const dinerA = await registerDiner('customer-limit-a');
    const dinerB = await registerDiner('customer-limit-b');

    await placeTakeoutOrder(publicCode, dinerA, item.id, 'ONCEEACH');
    // Same diner, second order — must be rejected even though the org-wide
    // usageLimit (unset here) would otherwise allow it.
    await expect(placeTakeoutOrder(publicCode, dinerA, item.id, 'ONCEEACH')).rejects.toThrow(ConflictError);

    // A *different* diner is unaffected by dinerA's own limit.
    const dinerBOrder = await placeTakeoutOrder(publicCode, dinerB, item.id, 'ONCEEACH');
    expect(dinerBOrder.discountTotal.toString()).toBe('20.00');

    const promotion = await prisma.promotion.findFirstOrThrow({ where: { organizationId: user.organizationId, promoCode: 'ONCEEACH' } });
    expect(promotion.redemptionCount).toBe(2); // one per successful diner
  });

  it('never lets a promo code from one restaurant be redeemed against a different restaurant', async () => {
    const orgA = await setupOrgWithMenu('cross-tenant-a');
    const orgB = await setupOrgWithMenu('cross-tenant-b');
    await createActivePromo(orgA.user.organizationId, orgA.user.id, 'SHARED10', {});

    const diner = await registerDiner('cross-tenant');

    // The exact same code, entered at orgB's storefront, must not resolve to
    // orgA's promotion — validateAndPreviewDiscount's lookup is scoped by
    // organizationId, so this should read as "no such code," never as a
    // cross-tenant discount applied by mistake.
    await expect(placeTakeoutOrder(orgB.publicCode, diner, orgB.item.id, 'SHARED10')).rejects.toThrow(NotFoundError);

    // The same code against its *own* restaurant still works normally.
    const order = await placeTakeoutOrder(orgA.publicCode, diner, orgA.item.id, 'SHARED10');
    expect(order.discountTotal.toString()).toBe('20.00');
  });

  it("a diner's claimed-offers list ('my offers') never surfaces another restaurant's promotions, even with the same customerAccountId", async () => {
    const orgA = await setupOrgWithMenu('claims-isolation-a');
    const orgB = await setupOrgWithMenu('claims-isolation-b');
    const promoA = await createActivePromo(orgA.user.organizationId, orgA.user.id, 'CLAIMA', {});
    await createActivePromo(orgB.user.organizationId, orgB.user.id, 'CLAIMB', {});

    const diner = await registerDiner('claims-isolation');
    await CustomerPromotionService.claim(orgA.publicCode, diner, promoA.id);

    const claimsAtOrgB = await CustomerPromotionService.listMine(orgB.publicCode, diner, { take: 50, skip: 0 });
    expect(claimsAtOrgB).toHaveLength(0);

    const claimsAtOrgA = await CustomerPromotionService.listMine(orgA.publicCode, diner, { take: 50, skip: 0 });
    expect(claimsAtOrgA).toHaveLength(1);
    expect(claimsAtOrgA[0]!.promotionId).toBe(promoA.id);
  });
});
