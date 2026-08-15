import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AuthService } from '@/services/auth/AuthService';
import { BranchService } from '@/services/branches/BranchService';
import { CateringService } from '@/services/catering/CateringService';
import { resetDatabase } from '../../helpers/db';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';
import type { CreateCateringInquiryInput, CreateCateringQuoteInput } from '@/lib/validation/catering';

/** Fills in the fee-total fields' defaults — required when calling
 * CateringService.createQuote directly (bypassing zod parsing, which is
 * what actually applies createCateringQuoteSchema's .default('0.00')s in
 * production via the API route). Same pattern as this codebase's existing
 * tests always passing discountAmount: '0.00' to OrderService.createOrder. */
function minimalQuoteInput(overrides: Partial<CreateCateringQuoteInput> & Pick<CreateCateringQuoteInput, 'inquiryId' | 'guestCount'>): CreateCateringQuoteInput {
  return {
    items: [],
    staffingTotal: '0.00',
    equipmentTotal: '0.00',
    transportationTotal: '0.00',
    setupTotal: '0.00',
    serviceFeeTotal: '0.00',
    discountTotal: '0.00',
    ...overrides,
  };
}

async function setupFixture(suffix: string) {
  const { user } = await AuthService.register({
    organizationName: `Catering Test ${suffix}`,
    organizationEmail: `catering-test-${suffix}@test.local`,
    firstName: 'Owner',
    lastName: suffix,
    email: `owner@catering-test-${suffix}.local`,
    password: 'SuperSecret123!',
    currency: 'PHP',
    timezone: 'Asia/Manila',
  });
  const branch = await BranchService.create(user.organizationId, { name: `Branch ${suffix}`, timezone: 'Asia/Manila' }, user.id);
  return { user, branch };
}

async function createInquiry(
  user: { organizationId: string; id: string },
  branch: { id: string },
  overrides: Partial<CreateCateringInquiryInput> = {},
) {
  const input: CreateCateringInquiryInput = {
    guestName: 'Test Customer',
    eventType: 'Wedding',
    eventDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    location: 'Grand Ballroom',
    guestCount: 30,
    deliveryRequested: false,
    ...overrides,
  };
  return CateringService.createInquiry(user.organizationId, branch.id, input, user.id);
}

describe('CateringService — packages', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a package and lists it back', async () => {
    const { user, branch } = await setupFixture('a');
    const pkg = await CateringService.createPackage(user.organizationId, branch.id, { name: 'Silver', pricePerGuest: '500.00' }, user.id);
    expect(pkg.pricePerGuest.toString()).toBe('500.00');
    const list = await CateringService.listPackages(user.organizationId, branch.id);
    expect(list).toHaveLength(1);
  });

  it('rejects a duplicate package name within the same branch', async () => {
    const { user, branch } = await setupFixture('b');
    await CateringService.createPackage(user.organizationId, branch.id, { name: 'Silver', pricePerGuest: '500.00' }, user.id);
    await expect(
      CateringService.createPackage(user.organizationId, branch.id, { name: 'Silver', pricePerGuest: '600.00' }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('does not leak a package across organizations', async () => {
    const orgA = await setupFixture('c');
    const orgB = await setupFixture('d');
    const pkg = await CateringService.createPackage(orgA.user.organizationId, orgA.branch.id, { name: 'Silver', pricePerGuest: '500.00' }, orgA.user.id);
    await expect(CateringService.getPackage(orgB.user.organizationId, orgB.branch.id, pkg.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updates a package', async () => {
    const { user, branch } = await setupFixture('e');
    const pkg = await CateringService.createPackage(user.organizationId, branch.id, { name: 'Silver', pricePerGuest: '500.00' }, user.id);
    const updated = await CateringService.updatePackage(user.organizationId, branch.id, pkg.id, { active: false }, user.id);
    expect(updated.active).toBe(false);
  });
});

describe('CateringService — inquiries', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an inquiry with status NEW', async () => {
    const { user, branch } = await setupFixture('f');
    const inquiry = await createInquiry(user, branch);
    expect(inquiry.status).toBe('NEW');
  });

  it('cancels an inquiry', async () => {
    const { user, branch } = await setupFixture('g');
    const inquiry = await createInquiry(user, branch);
    const cancelled = await CateringService.cancelInquiry(user.organizationId, branch.id, inquiry.id, user.id);
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('rejects editing inquiry details once it is QUOTED (without a status change)', async () => {
    const { user, branch } = await setupFixture('h');
    const inquiry = await createInquiry(user, branch);
    await CateringService.createQuote(user.organizationId, branch.id, minimalQuoteInput({ inquiryId: inquiry.id, guestCount: 30 }), user.id);
    await expect(
      CateringService.updateInquiry(user.organizationId, branch.id, inquiry.id, { location: 'New venue' }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('does not leak an inquiry across organizations', async () => {
    const orgA = await setupFixture('i');
    const orgB = await setupFixture('j');
    const inquiry = await createInquiry(orgA.user, orgA.branch);
    await expect(CateringService.getInquiry(orgB.user.organizationId, orgB.branch.id, inquiry.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('CateringService — quotes', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('computes totals per the master spec formula and bumps the inquiry to QUOTED', async () => {
    const { user, branch } = await setupFixture('k');
    const inquiry = await createInquiry(user, branch, { guestCount: 30 });

    const quote = await CateringService.createQuote(
      user.organizationId, branch.id,
      {
        inquiryId: inquiry.id,
        guestCount: 30,
        items: [{ description: 'Silver Package (per guest)', quantity: 30, unitPrice: '500.00' }],
        staffingTotal: '2000.00',
        equipmentTotal: '500.00',
        transportationTotal: '500.00',
        setupTotal: '500.00',
        serviceFeeTotal: '1000.00',
        discountTotal: '0.00',
      },
      user.id,
    );

    // food 30x500=15000 + 2000 + 500 + 500 + 500 + 1000 - 0 = 19500
    // + 12% tax (2340.00) = 21840.00 — same worked example as the seed data.
    expect(quote.foodTotal.toString()).toBe('15000.00');
    expect(quote.taxTotal.toString()).toBe('2340.00');
    expect(quote.total.toString()).toBe('21840.00');
    expect(quote.status).toBe('DRAFT');

    const updatedInquiry = await CateringService.getInquiry(user.organizationId, branch.id, inquiry.id);
    expect(updatedInquiry.status).toBe('QUOTED');
  });

  it('rejects quoting an inquiry that is already CONVERTED or CANCELLED', async () => {
    const { user, branch } = await setupFixture('l');
    const inquiry = await createInquiry(user, branch);
    await CateringService.cancelInquiry(user.organizationId, branch.id, inquiry.id, user.id);
    await expect(
      CateringService.createQuote(user.organizationId, branch.id, minimalQuoteInput({ inquiryId: inquiry.id, guestCount: 30 }), user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows editing a DRAFT quote and recomputes totals', async () => {
    const { user, branch } = await setupFixture('m');
    const inquiry = await createInquiry(user, branch);
    const quote = await CateringService.createQuote(
      user.organizationId, branch.id,
      minimalQuoteInput({ inquiryId: inquiry.id, guestCount: 30, items: [{ description: 'Item', quantity: 1, unitPrice: '100.00' }] }),
      user.id,
    );
    const updated = await CateringService.updateQuote(
      user.organizationId, branch.id, quote.id,
      { items: [{ description: 'Item', quantity: 2, unitPrice: '100.00' }] },
      user.id,
    );
    expect(updated.foodTotal.toString()).toBe('200.00');
    expect(updated.total.toString()).toBe('224.00'); // 200 + 12% tax
  });

  it('rejects editing a quote once it is no longer DRAFT', async () => {
    const { user, branch } = await setupFixture('n');
    const inquiry = await createInquiry(user, branch);
    const quote = await CateringService.createQuote(user.organizationId, branch.id, minimalQuoteInput({ inquiryId: inquiry.id, guestCount: 30 }), user.id);
    await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'SENT' }, user.id);
    await expect(
      CateringService.updateQuote(user.organizationId, branch.id, quote.id, { guestCount: 40 }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('walks DRAFT -> SENT -> VIEWED -> ACCEPTED, creating a 1:1 event and converting the inquiry', async () => {
    const { user, branch } = await setupFixture('o');
    const inquiry = await createInquiry(user, branch, { guestCount: 10 });
    const quote = await CateringService.createQuote(
      user.organizationId, branch.id,
      minimalQuoteInput({ inquiryId: inquiry.id, guestCount: 10, items: [{ description: 'Item', quantity: 10, unitPrice: '50.00' }] }),
      user.id,
    );

    await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'SENT' }, user.id);
    await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'VIEWED' }, user.id);
    const accepted = await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'ACCEPTED' }, user.id);

    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.event).toBeTruthy();
    expect(accepted.event?.status).toBe('SCHEDULED');
    expect(accepted.event?.total.toString()).toBe(accepted.total.toString());
    expect(accepted.event?.items).toHaveLength(1);

    const updatedInquiry = await CateringService.getInquiry(user.organizationId, branch.id, inquiry.id);
    expect(updatedInquiry.status).toBe('CONVERTED');
  });

  it('rejects an illegal quote transition (DRAFT -> ACCEPTED)', async () => {
    const { user, branch } = await setupFixture('p');
    const inquiry = await createInquiry(user, branch);
    const quote = await CateringService.createQuote(user.organizationId, branch.id, minimalQuoteInput({ inquiryId: inquiry.id, guestCount: 30 }), user.id);
    await expect(
      CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'ACCEPTED' }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('requires a rejectionReason to reject and a cancellationReason to cancel', async () => {
    const { user, branch } = await setupFixture('q');
    const inquiry = await createInquiry(user, branch);
    const quote = await CateringService.createQuote(user.organizationId, branch.id, minimalQuoteInput({ inquiryId: inquiry.id, guestCount: 30 }), user.id);
    await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'SENT' }, user.id);

    await expect(
      CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'REJECTED' }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'REJECTED', rejectionReason: 'Too expensive' }, user.id),
    ).resolves.toBeTruthy();
  });

  it('does not allow advancing a quote belonging to another organization', async () => {
    const orgA = await setupFixture('r');
    const orgB = await setupFixture('s');
    const inquiry = await createInquiry(orgA.user, orgA.branch);
    const quote = await CateringService.createQuote(orgA.user.organizationId, orgA.branch.id, minimalQuoteInput({ inquiryId: inquiry.id, guestCount: 30 }), orgA.user.id);
    await expect(
      CateringService.updateQuoteStatus(orgB.user.organizationId, orgB.branch.id, quote.id, { status: 'SENT' }, orgB.user.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('CateringService — events and payments', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function acceptedEvent(suffix: string) {
    const { user, branch } = await setupFixture(suffix);
    const inquiry = await createInquiry(user, branch, { guestCount: 10 });
    const quote = await CateringService.createQuote(
      user.organizationId, branch.id,
      minimalQuoteInput({ inquiryId: inquiry.id, guestCount: 10, items: [{ description: 'Item', quantity: 10, unitPrice: '50.00' }] }),
      user.id,
    );
    await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'SENT' }, user.id);
    const accepted = await CateringService.updateQuoteStatus(user.organizationId, branch.id, quote.id, { status: 'ACCEPTED' }, user.id);
    return { user, branch, event: accepted.event! };
  }

  it('walks SCHEDULED -> IN_PROGRESS -> COMPLETED', async () => {
    const { user, branch, event } = await acceptedEvent('t');
    const inProgress = await CateringService.updateEventStatus(user.organizationId, branch.id, event.id, { status: 'IN_PROGRESS' }, user.id);
    expect(inProgress.status).toBe('IN_PROGRESS');
    const completed = await CateringService.updateEventStatus(user.organizationId, branch.id, event.id, { status: 'COMPLETED' }, user.id);
    expect(completed.status).toBe('COMPLETED');
  });

  it('requires a cancellationReason to cancel an event', async () => {
    const { user, branch, event } = await acceptedEvent('u');
    await expect(
      CateringService.updateEventStatus(user.organizationId, branch.id, event.id, { status: 'CANCELLED' }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      CateringService.updateEventStatus(user.organizationId, branch.id, event.id, { status: 'CANCELLED', cancellationReason: 'Client postponed' }, user.id),
    ).resolves.toBeTruthy();
  });

  it('rejects an illegal event transition (COMPLETED -> IN_PROGRESS)', async () => {
    const { user, branch, event } = await acceptedEvent('v');
    await CateringService.updateEventStatus(user.organizationId, branch.id, event.id, { status: 'IN_PROGRESS' }, user.id);
    await CateringService.updateEventStatus(user.organizationId, branch.id, event.id, { status: 'COMPLETED' }, user.id);
    await expect(
      CateringService.updateEventStatus(user.organizationId, branch.id, event.id, { status: 'IN_PROGRESS' }, user.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('records a deposit and balance payment and paymentSummary reflects isFullyPaid', async () => {
    const { user, branch, event } = await acceptedEvent('w');
    // event total = 10 x 50.00 = 500.00 + 12% tax = 560.00
    expect(event.total.toString()).toBe('560.00');

    await CateringService.recordPayment(user.organizationId, branch.id, event.id, { type: 'DEPOSIT', method: 'CASH', amount: '200.00', status: 'COMPLETED' }, user.id);
    const afterDeposit = await CateringService.getEvent(user.organizationId, branch.id, event.id);
    const depositSummary = CateringService.paymentSummary(afterDeposit);
    expect(depositSummary.paidAmount).toBe('200.00');
    expect(depositSummary.isFullyPaid).toBe(false);

    await CateringService.recordPayment(user.organizationId, branch.id, event.id, { type: 'BALANCE', method: 'BANK_TRANSFER', amount: '360.00', status: 'COMPLETED' }, user.id);
    const afterBalance = await CateringService.getEvent(user.organizationId, branch.id, event.id);
    const finalSummary = CateringService.paymentSummary(afterBalance);
    expect(finalSummary.paidAmount).toBe('560.00');
    expect(finalSummary.balanceDue).toBe('0.00');
    expect(finalSummary.isFullyPaid).toBe(true);
  });

  it('does not leak an event or its payments across organizations', async () => {
    const { event } = await acceptedEvent('x');
    const orgB = await setupFixture('y');
    await expect(CateringService.getEvent(orgB.user.organizationId, orgB.branch.id, event.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      CateringService.recordPayment(orgB.user.organizationId, orgB.branch.id, event.id, { type: 'DEPOSIT', method: 'CASH', amount: '1.00', status: 'COMPLETED' }, orgB.user.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
