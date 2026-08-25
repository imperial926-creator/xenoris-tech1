import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';
import { CateringService, QUOTE_INCLUDE } from '@/services/catering/CateringService';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import type {
  CustomerCreateCateringInquiryInput,
  CustomerListCateringInquiriesQueryInput,
  CustomerQuoteResponseInput,
  CustomerQuoteChangeRequestInput,
  CustomerCateringPaymentInput,
} from '@/lib/validation/customer-catering';

/**
 * CAPP Phase 6 — catering, spec § 13. This is the customer app's only entry
 * point into the catering funnel, same "reuse the staff transaction, never
 * a parallel pipeline" shape as `CustomerOrderService`/
 * `CustomerReservationService`.
 *
 * Two scope decisions, both forced by what actually exists in the base
 * platform's Phase 7 catering module (see
 * docs/customer-app/architecture.md § 16 for the full writeup):
 *
 * 1. "Request changes" has no dedicated `CateringQuoteStatus` value — a
 *    `CHANGES_REQUESTED` state would ripple through `QUOTE_ALLOWED_TRANSITIONS`
 *    and every staff view that reads quote status for something that, in
 *    real catering practice, is a message attached to an otherwise-still
 *    -open quote, not a new lifecycle stage. `requestQuoteChanges` below
 *    calls the new `CateringService.recordCustomerQuoteNote`, which writes
 *    to the new `CateringQuote.customerNote` column without touching
 *    `status`.
 * 2. Paying a deposit never triggers revenue/liability postings.
 *    `AccountingService.recordCateringDepositReceived` only fires when a
 *    payment is recorded `COMPLETED`, and — same "never claim a payment is
 *    successful until the backend has verified it" rule Phase 4/5 apply to
 *    Order payments — `payTowardBalance` below always records `PENDING`.
 *    That's an honest limitation of "no payment gateway is configured yet"
 *    (`lib/payments/PaymentProvider.ts`), not a bug: a diner's in-app
 *    "payment" is a stated intent staff still confirm/settle for real.
 */
export class CustomerCateringService {
  /**
   * Submits a catering inquiry (spec § 13's "BOOK CATERING"). Server-side
   * identity resolution mirrors `CustomerOrderService.createOrder` exactly
   * — the diner's contact details come from their `Customer`/
   * `CustomerAccount` profile, never free text in the request body.
   */
  static async createInquiry(
    publicCode: string,
    customerAccountId: string,
    input: CustomerCreateCateringInquiryInput,
  ) {
    const { organizationId, branchId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await CustomerAccountService.getOrCreateCustomerProfile(organizationId, customerAccountId);
    const account = await prisma.customerAccount.findUniqueOrThrow({ where: { id: customerAccountId } });

    const eventDate = this.parseEventDate(input.eventDate);

    const inquiry = await CateringService.createInquiry(
      organizationId,
      branchId,
      {
        customerId: customer.id,
        guestName: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || account.firstName,
        guestEmail: customer.email ?? account.email ?? undefined,
        guestPhone: customer.phone ?? account.mobile ?? undefined,
        eventType: input.eventType,
        eventDate: eventDate.toISOString(),
        location: input.location,
        guestCount: input.guestCount,
        menuRequirements: input.menuRequirements,
        deliveryRequested: false,
        specialRequests: input.specialRequests,
        budget: input.budget,
      },
      // No staff actor — see CateringService.createInquiry's JSDoc for why
      // a CustomerAccount id must never be passed here instead.
      null,
    );

    // Same reasoning as CustomerOrderService.createOrder's second audit
    // entry: CateringService's own internal audit log already recorded this
    // with `userId: null` (honest — no staff actor); this customer-scoped
    // entry is what actually lets anyone trace "which CustomerAccount
    // submitted this inquiry" later.
    await writeAuditLog(prisma, {
      organizationId,
      branchId,
      action: 'catering_inquiry.customer_create',
      entityType: 'CateringInquiry',
      entityId: inquiry.id,
      newValue: { customerAccountId, customerId: customer.id },
    });

    return inquiry;
  }

  /** A diner's own catering inquiries at this restaurant, each with its quotes (spec § 13's funnel is inquiry -> quote -> respond -> pay, all viewed together). */
  static async list(publicCode: string, customerAccountId: string, query: CustomerListCateringInquiriesQueryInput) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await CustomerAccountService.findCustomerProfile(organizationId, customerAccountId);
    if (!customer) return [];

    return prisma.cateringInquiry.findMany({
      where: { organizationId, customerId: customer.id },
      include: { quotes: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
    });
  }

  /** Single inquiry detail (with quotes), scoped to the requesting diner — never another customer's inquiry, even at the same restaurant. */
  static async get(publicCode: string, customerAccountId: string, inquiryId: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await CustomerAccountService.findCustomerProfile(organizationId, customerAccountId);
    if (!customer) throw new NotFoundError('Catering inquiry');

    const inquiry = await prisma.cateringInquiry.findFirst({
      where: { id: inquiryId, organizationId, customerId: customer.id },
      include: { quotes: { orderBy: { createdAt: 'desc' } } },
    });
    if (!inquiry) throw new NotFoundError('Catering inquiry');
    return inquiry;
  }

  /**
   * Single quote detail, scoped to the requesting diner. Auto-transitions
   * SENT -> VIEWED the first time a diner actually opens it — the same
   * signal a real catering platform's "quote viewed" read receipt gives
   * staff, using the state `CateringQuoteStatus` already has for exactly
   * this rather than adding anything new. Response includes `balance`
   * (`CateringService.paymentSummary` against the linked event, once one
   * exists) for spec § 13's "View balance".
   */
  static async getQuote(publicCode: string, customerAccountId: string, quoteId: string) {
    const { organizationId, branchId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await this.requireOwnCustomerProfile(organizationId, customerAccountId);
    let quote = await this.resolveOwnQuote(organizationId, branchId, customer.id, quoteId);

    if (quote.status === 'SENT') {
      quote = await CateringService.updateQuoteStatus(organizationId, branchId, quoteId, { status: 'VIEWED' }, null);
    }

    return { ...quote, balance: quote.event ? CateringService.paymentSummary(quote.event) : null };
  }

  /** "Accept" / "Decline" (spec § 13). Reuses CateringService.updateQuoteStatus's existing ACCEPTED/REJECTED transitions — accepting creates the CateringEvent in the same transaction, exactly as it does for staff. */
  static async respondToQuote(
    publicCode: string,
    customerAccountId: string,
    quoteId: string,
    input: CustomerQuoteResponseInput,
  ) {
    const { organizationId, branchId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await this.requireOwnCustomerProfile(organizationId, customerAccountId);
    await this.resolveOwnQuote(organizationId, branchId, customer.id, quoteId);

    const quote = await CateringService.updateQuoteStatus(
      organizationId,
      branchId,
      quoteId,
      { status: input.status, rejectionReason: input.rejectionReason },
      null,
    );

    await writeAuditLog(prisma, {
      organizationId,
      branchId,
      action: 'catering_quote.customer_response',
      entityType: 'CateringQuote',
      entityId: quoteId,
      newValue: { customerAccountId, customerId: customer.id, status: input.status },
    });

    return quote;
  }

  /** "Request changes" (spec § 13) — see this class's header comment for why this is a note, not a status transition. */
  static async requestQuoteChanges(
    publicCode: string,
    customerAccountId: string,
    quoteId: string,
    input: CustomerQuoteChangeRequestInput,
  ) {
    const { organizationId, branchId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await this.requireOwnCustomerProfile(organizationId, customerAccountId);
    await this.resolveOwnQuote(organizationId, branchId, customer.id, quoteId);

    const quote = await CateringService.recordCustomerQuoteNote(organizationId, branchId, quoteId, input.note, null);

    await writeAuditLog(prisma, {
      organizationId,
      branchId,
      action: 'catering_quote.customer_request_changes',
      entityType: 'CateringQuote',
      entityId: quoteId,
      newValue: { customerAccountId, customerId: customer.id, note: input.note },
    });

    return quote;
  }

  /**
   * "Pay deposit" (spec § 13), also usable for a full/partial balance
   * payment (`input.type: 'BALANCE'`) since the underlying `CateringPayment`
   * model treats both the same way. Only possible once a quote has been
   * accepted (a `CateringEvent` exists) — see this class's header comment
   * for why this always records `PENDING`, never `COMPLETED`.
   */
  static async payTowardBalance(
    publicCode: string,
    customerAccountId: string,
    quoteId: string,
    input: CustomerCateringPaymentInput,
  ) {
    const { organizationId, branchId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await this.requireOwnCustomerProfile(organizationId, customerAccountId);
    const quote = await this.resolveOwnQuote(organizationId, branchId, customer.id, quoteId);

    if (!quote.event) {
      throw new ConflictError('This quote has not been accepted yet — there is nothing to pay towards.');
    }

    const balance = CateringService.paymentSummary(quote.event);
    if (Number(input.amount) > Number(balance.balanceDue)) {
      throw new ConflictError(`Amount exceeds the remaining balance of ${balance.balanceDue}.`);
    }

    const event = await CateringService.recordPayment(
      organizationId,
      branchId,
      quote.event.id,
      {
        type: input.type,
        method: input.method,
        amount: input.amount,
        status: 'PENDING',
        note:
          input.note ??
          'Customer-recorded payment via the app — pending confirmation/settlement by the restaurant.',
      },
      null,
    );

    await writeAuditLog(prisma, {
      organizationId,
      branchId,
      action: 'catering_event.customer_payment',
      entityType: 'CateringEvent',
      entityId: quote.event.id,
      newValue: { customerAccountId, customerId: customer.id, type: input.type, amount: input.amount },
    });

    return event;
  }

  // --- helpers ------------------------------------------------------------

  private static parseEventDate(eventDateRaw: string): Date {
    const eventDate = new Date(eventDateRaw);
    if (Number.isNaN(eventDate.getTime())) {
      throw new ConflictError('eventDate is not a valid date/time.');
    }
    // Same small grace window as CustomerOrderService.parsePickupTime's
    // past-time check.
    if (eventDate <= new Date(Date.now() - 5 * 60 * 1000)) {
      throw new ConflictError('Event date cannot be in the past.');
    }
    return eventDate;
  }

  /** Unlike `list`/`get`'s read-only lookups, every mutating method below needs a real Customer.id to scope its ownership check against — a diner with no profile yet cannot own any quote, so this 404s rather than silently creating one just to fail the next check anyway. */
  private static async requireOwnCustomerProfile(organizationId: string, customerAccountId: string) {
    const customer = await CustomerAccountService.findCustomerProfile(organizationId, customerAccountId);
    if (!customer) throw new NotFoundError('Catering quote');
    return customer;
  }

  /** Loads a quote via the shared CateringService.getQuote (same QUOTE_INCLUDE shape the staff dashboard sees) and asserts it belongs to an inquiry owned by this customer — a quote id from another diner, or from a staff-recorded walk-in inquiry with no linked customerId, 404s exactly like a nonexistent one. */
  private static async resolveOwnQuote(organizationId: string, branchId: string, customerId: string, quoteId: string) {
    const quote = await CateringService.getQuote(organizationId, branchId, quoteId);
    if (quote.inquiry.customerId !== customerId) {
      throw new NotFoundError('Catering quote');
    }
    return quote;
  }
}

// Re-exported for route handlers that only need the include shape for
// typing a response, mirroring OrderService.ORDER_INCLUDE's usage.
export { QUOTE_INCLUDE };
