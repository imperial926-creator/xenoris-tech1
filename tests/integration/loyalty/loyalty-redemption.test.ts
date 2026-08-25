import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { LoyaltyService } from '@/services/loyalty/LoyaltyService';
import { ConflictError } from '@/lib/utils/api-error';
import { resetDatabase } from '../../helpers/db';

/**
 * CAPP Phase 12 hardening — spec § 37 "Loyalty" had zero test coverage
 * through CAPP Phase 10. `LoyaltyService.redeemPoints` uses an atomic
 * `updateMany` with a `pointsBalance: { gte: points }` WHERE-guard rather
 * than a read-then-write, specifically to prevent a points balance from
 * ever going negative under concurrent redemption — this proves that
 * guarantee under genuine concurrency (`Promise.allSettled`, not just
 * sequential calls), the same rigor `invoice-service.test.ts`'s own
 * concurrent-issuance test applies to sequential numbering.
 */

async function setupOrgAndDiner(suffix: string, startingPoints: number) {
  const { user } = await AuthService.register({
    organizationName: `Loyalty Test ${suffix}`,
    organizationEmail: `loyalty-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@loyalty-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  const diner = await CustomerAccountService.register(
    {
      email: `diner-loyalty-${suffix}@example.com`,
      password: 'SuperSecret123!',
      firstName: 'Dina',
      lastName: 'Diner',
      marketingOptIn: false,
      acceptedTerms: true,
      acceptedPrivacy: true,
    },
    {},
  );
  const account = await prisma.loyaltyAccount.create({
    data: {
      organizationId: user.organizationId,
      customerAccountId: diner.customer.id,
      pointsBalance: startingPoints,
      lifetimePoints: startingPoints,
    },
  });
  return { user, customerAccountId: diner.customer.id, account };
}

describe('Loyalty points redemption', () => {
  beforeAll(() => {
    process.env.CUSTOMER_AUTH_SECRET =
      'test-customer-secret-do-not-use-in-production-gggggggggggggggggggggggggggggggg';
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects a single redemption for more points than the account holds', async () => {
    const { user, customerAccountId } = await setupOrgAndDiner('over-redeem', 50);

    await expect(
      prisma.$transaction((tx) => LoyaltyService.redeemPoints(tx, user.organizationId, customerAccountId, 51, null, 'test')),
    ).rejects.toThrow(ConflictError);

    const account = await prisma.loyaltyAccount.findFirstOrThrow({ where: { organizationId: user.organizationId, customerAccountId } });
    expect(account.pointsBalance).toBe(50); // untouched — the rejected attempt must not partially apply
  });

  it('never lets a points balance go negative under genuinely concurrent redemptions', async () => {
    const { user, customerAccountId } = await setupOrgAndDiner('concurrent-redeem', 100);

    // Three concurrent attempts to redeem 60 points each against a balance
    // of 100 — at most one can succeed (60), a second 60 would overdraw.
    // If the WHERE-guard were a read-then-write instead of atomic, more
    // than one of these could observe the pre-redemption balance and all
    // "succeed," driving pointsBalance negative.
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        prisma.$transaction((tx) => LoyaltyService.redeemPoints(tx, user.organizationId, customerAccountId, 60, null, 'concurrent test')),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);

    const account = await prisma.loyaltyAccount.findFirstOrThrow({ where: { organizationId: user.organizationId, customerAccountId } });
    expect(account.pointsBalance).toBe(40); // 100 - 60, never negative
    expect(account.pointsBalance).toBeGreaterThanOrEqual(0);

    const transactions = await prisma.loyaltyTransaction.findMany({ where: { loyaltyAccountId: account.id } });
    expect(transactions).toHaveLength(1); // only the one successful redemption left a ledger row
  });

  it('scopes a loyalty account per restaurant — points earned at one org are invisible/unspendable at another', async () => {
    const orgA = await setupOrgAndDiner('scope-a', 100);
    // Same diner email domain but a fresh registration would collide, so
    // register once and open a second, independent LoyaltyAccount for the
    // *same* customerAccountId at a second organization with zero points —
    // the real-world case of a diner who is a member of restaurant A's
    // program but has never earned anything at restaurant B.
    const { user: orgBUser } = await AuthService.register({
      organizationName: 'Loyalty Test scope-b',
      organizationEmail: 'loyalty-test-scope-b@test.local',
      firstName: 'Owner',
      lastName: 'scope-b',
      email: 'owner@loyalty-test-scope-b.local',
      password: 'SuperSecret123!',
      currency: 'PHP',
      timezone: 'Asia/Manila',
    });

    // The diner has never interacted with orgB, so no LoyaltyAccount row
    // exists there yet — attempting to redeem must fail on insufficient
    // points (a fresh, lazily-created account starts at 0), never succeed
    // by accidentally reading orgA's balance.
    await expect(
      prisma.$transaction((tx) => LoyaltyService.redeemPoints(tx, orgBUser.organizationId, orgA.customerAccountId, 10, null, 'cross-org test')),
    ).rejects.toThrow(ConflictError);

    const orgBAccount = await prisma.loyaltyAccount.findUnique({
      where: { organizationId_customerAccountId: { organizationId: orgBUser.organizationId, customerAccountId: orgA.customerAccountId } },
    });
    expect(orgBAccount?.pointsBalance ?? 0).toBe(0);

    // orgA's own balance is untouched by the attempt against orgB.
    const orgAAccount = await prisma.loyaltyAccount.findFirstOrThrow({
      where: { organizationId: orgA.user.organizationId, customerAccountId: orgA.customerAccountId },
    });
    expect(orgAAccount.pointsBalance).toBe(100);
  });
});
