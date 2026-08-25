import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { CustomerCateringService } from '@/services/customer/CustomerCateringService';
import { CateringService } from '@/services/catering/CateringService';
import { resetDatabase } from '../../helpers/db';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';

async function setupOrg(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Customer Catering Test ${suffix}`,
    organizationEmail: `customer-catering-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@customer-catering-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  const branch = await BranchService.create(user.organizationId, { name: `Branch ${suffix}`, timezone: 'Asia/Manila' }, user.id);
  const orgRow = await prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
  return { user, branch, publicCode: orgRow.publicCode! };
}

async function registerDiner(suffix: string) {
  const result = await CustomerAccountService.register(
    {
      email: `diner-catering-${suffix}@example.com`,
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

function daysFromNow(d: number) {
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();
}

describe('CustomerCateringService', () => {
  beforeAll(() => {
    process.env.CUSTOMER_AUTH_SECRET =
      'test-customer-secret-do-not-use-in-production-dddddddddddddddddddddddddddddddd';
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('submits a catering inquiry with server-resolved contact identity and an optional budget', async () => {
    const { user, publicCode } = await setupOrg('create-1');
    const customerAccountId = await registerDiner('create-1');

    const inquiry = await CustomerCateringService.createInquiry(publicCode, customerAccountId, {
      eventType: 'Wedding',
      eventDate: daysFromNow(30),
      location: 'Grand Ballroom, Makati',
      guestCount: 150,
      budget: '50000.00',
      specialRequests: 'Need a projector',
    });

    expect(inquiry.status).toBe('NEW');
    expect(inquiry.guestName).toBe('Dina Diner');
    expect(inquiry.budget?.toString()).toBe('50000.00');

    const customer = await prisma.customer.findFirst({ where: { organizationId: user.organizationId } });
    expect(customer?.customerAccountId).toBe(customerAccountId);
    expect(inquiry.customerId).toBe(customer!.id);
  });

  it('rejects an inquiry with an event date in the past', async () => {
    const { publicCode } = await setupOrg('create-2');
    const customerAccountId = await registerDiner('create-2');

    await expect(
      CustomerCateringService.createInquiry(publicCode, customerAccountId, {
        eventType: 'Birthday',
        eventDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        location: 'Somewhere',
        guestCount: 20,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('list returns an empty array (not an error) for a diner who has never inquired here', async () => {
    const { publicCode } = await setupOrg('list-1');
    const customerAccountId = await registerDiner('list-1');
    const inquiries = await CustomerCateringService.list(publicCode, customerAccountId, { take: 50, skip: 0 });
    expect(inquiries).toEqual([]);
  });

  it('list and get only return the requesting diner\'s own inquiries', async () => {
    const { publicCode } = await setupOrg('list-2');
    const dinerA = await registerDiner('list-2-a');
    const dinerB = await registerDiner('list-2-b');

    const inquiry = await CustomerCateringService.createInquiry(publicCode, dinerA, {
      eventType: 'Corporate event',
      eventDate: daysFromNow(20),
      location: 'Office HQ',
      guestCount: 40,
    });

    const dinerAInquiries = await CustomerCateringService.list(publicCode, dinerA, { take: 50, skip: 0 });
    expect(dinerAInquiries).toHaveLength(1);
    const dinerBInquiries = await CustomerCateringService.list(publicCode, dinerB, { take: 50, skip: 0 });
    expect(dinerBInquiries).toHaveLength(0);

    await expect(CustomerCateringService.get(publicCode, dinerB, inquiry.id)).rejects.toThrow(NotFoundError);
    const fetched = await CustomerCateringService.get(publicCode, dinerA, inquiry.id);
    expect(fetched.id).toBe(inquiry.id);
  });

  // --- quote lifecycle -----------------------------------------------------

  async function setupInquiryAndSentQuote(suffix: string) {
    const { user, branch, publicCode } = await setupOrg(suffix);
    const customerAccountId = await registerDiner(suffix);

    const inquiry = await CustomerCateringService.createInquiry(publicCode, customerAccountId, {
      eventType: 'Wedding',
      eventDate: daysFromNow(30),
      location: 'Grand Ballroom, Makati',
      guestCount: 100,
    });

    const draftQuote = await CateringService.createQuote(
      user.organizationId,
      branch.id,
      {
        inquiryId: inquiry.id,
        guestCount: 100,
        items: [{ description: 'Buffet package', quantity: 100, unitPrice: '500.00' }],
        staffingTotal: '5000.00',
        equipmentTotal: '0.00',
        transportationTotal: '0.00',
        setupTotal: '0.00',
        serviceFeeTotal: '0.00',
        discountTotal: '0.00',
      },
      user.id,
    );
    const sentQuote = await CateringService.updateQuoteStatus(
      user.organizationId,
      branch.id,
      draftQuote.id,
      { status: 'SENT' },
      user.id,
    );

    return { user, branch, publicCode, customerAccountId, inquiry, quote: sentQuote };
  }

  it('getQuote auto-transitions SENT -> VIEWED the first time the diner opens it, and includes a null balance before acceptance', async () => {
    const { publicCode, customerAccountId, quote } = await setupInquiryAndSentQuote('quote-1');

    const viewed = await CustomerCateringService.getQuote(publicCode, customerAccountId, quote.id);
    expect(viewed.status).toBe('VIEWED');
    expect(viewed.balance).toBeNull();

    // Opening it again does not error or bounce it back to SENT.
    const viewedAgain = await CustomerCateringService.getQuote(publicCode, customerAccountId, quote.id);
    expect(viewedAgain.status).toBe('VIEWED');
  });

  it('getQuote 404s for a quote belonging to another diner\'s inquiry', async () => {
    const { publicCode, quote } = await setupInquiryAndSentQuote('quote-2');
    const otherDiner = await registerDiner('quote-2-other');

    await expect(CustomerCateringService.getQuote(publicCode, otherDiner, quote.id)).rejects.toThrow(NotFoundError);
  });

  it('respondToQuote Accept creates a CateringEvent and converts the inquiry', async () => {
    const { publicCode, customerAccountId, quote } = await setupInquiryAndSentQuote('quote-3');

    const accepted = await CustomerCateringService.respondToQuote(publicCode, customerAccountId, quote.id, {
      status: 'ACCEPTED',
    });
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.event).not.toBeNull();

    const inquiry = await prisma.cateringInquiry.findUniqueOrThrow({ where: { id: accepted.inquiryId } });
    expect(inquiry.status).toBe('CONVERTED');
  });

  it('respondToQuote Decline requires a rejectionReason and does not create an event', async () => {
    const { publicCode, customerAccountId, quote } = await setupInquiryAndSentQuote('quote-4');

    const declined = await CustomerCateringService.respondToQuote(publicCode, customerAccountId, quote.id, {
      status: 'REJECTED',
      rejectionReason: 'Went with another caterer',
    });
    expect(declined.status).toBe('REJECTED');
    expect(declined.event).toBeNull();
  });

  it('requestQuoteChanges records a note without changing status', async () => {
    const { publicCode, customerAccountId, quote } = await setupInquiryAndSentQuote('quote-5');

    const noted = await CustomerCateringService.requestQuoteChanges(publicCode, customerAccountId, quote.id, {
      note: 'Can we swap the dessert station?',
    });
    expect(noted.customerNote).toBe('Can we swap the dessert station?');
    expect(noted.status).toBe('SENT'); // unchanged — a note, not a transition
  });

  // --- payments -------------------------------------------------------------

  it('payTowardBalance rejects paying before the quote is accepted', async () => {
    const { publicCode, customerAccountId, quote } = await setupInquiryAndSentQuote('pay-1');

    await expect(
      CustomerCateringService.payTowardBalance(publicCode, customerAccountId, quote.id, {
        type: 'DEPOSIT',
        method: 'GCASH',
        amount: '5000.00',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('payTowardBalance always records a PENDING payment, never COMPLETED, and rejects overpaying the balance', async () => {
    const { publicCode, customerAccountId, quote } = await setupInquiryAndSentQuote('pay-2');
    await CustomerCateringService.respondToQuote(publicCode, customerAccountId, quote.id, { status: 'ACCEPTED' });

    const event = await CustomerCateringService.payTowardBalance(publicCode, customerAccountId, quote.id, {
      type: 'DEPOSIT',
      method: 'GCASH',
      amount: '10000.00',
    });
    const payment = event.payments.find((p) => p.amount.toString() === '10000.00');
    expect(payment).toBeDefined();
    expect(payment!.status).toBe('PENDING');

    // Paying more than the (still-unpaid, since the deposit above is PENDING
    // not COMPLETED) balance is rejected.
    await expect(
      CustomerCateringService.payTowardBalance(publicCode, customerAccountId, quote.id, {
        type: 'BALANCE',
        method: 'CARD',
        amount: '999999.00',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('payTowardBalance 404s for a quote belonging to another diner', async () => {
    const { publicCode, customerAccountId, quote } = await setupInquiryAndSentQuote('pay-3');
    await CustomerCateringService.respondToQuote(publicCode, customerAccountId, quote.id, { status: 'ACCEPTED' });
    const otherDiner = await registerDiner('pay-3-other');

    await expect(
      CustomerCateringService.payTowardBalance(publicCode, otherDiner, quote.id, {
        type: 'DEPOSIT',
        method: 'CASH',
        amount: '1000.00',
      }),
    ).rejects.toThrow(NotFoundError);
  });
});
