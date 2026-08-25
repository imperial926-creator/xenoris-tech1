import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';
import { ReservationService } from '@/services/reservations/ReservationService';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { canSeatParty, selectTables } from '@/lib/utils/table-assignment';
import type {
  CustomerAvailabilityQueryInput,
  CustomerCreateReservationInput,
  CustomerListReservationsQueryInput,
} from '@/lib/validation/customer-reservation';

/**
 * CAPP Phase 3 — dine-in reservations, spec § 10. This is the customer
 * mobile app's ONLY entry point into the reservation system; it never
 * exposes `ReservationService.createReservation`'s staff shape directly
 * (that requires an explicit `tableIds` pick — see
 * `lib/validation/customer-reservation.ts`'s header comment). Instead this
 * service resolves the diner's restaurant/branch/identity, auto-assigns
 * table(s) against the same `findAvailableTables` primitive the staff
 * dashboard's availability screen uses, and then creates the booking
 * through the existing transactional/audit-logged/double-booking-safe
 * path — "reuse existing infrastructure" (spec's dev principles § 10),
 * not a parallel booking pipeline.
 */
export class CustomerReservationService {
  /**
   * Live availability check for the booking form — spec § 10's "System
   * checks live availability. Backend is the source of truth." Returns
   * whether the requested party size fits at all (single table or a
   * combination), plus the distinct seating types (TableSection names)
   * that currently have room, so the client can offer a meaningful
   * "preferred seating" picker instead of a free-text guess.
   */
  static async checkAvailability(publicCode: string, query: CustomerAvailabilityQueryInput) {
    const { organizationId, branchId } = await this.resolveStorefront(publicCode);
    const tables = await ReservationService.findAvailableTables(organizationId, branchId, {
      startAt: query.startAt,
      durationMinutes: query.durationMinutes,
      guestCount: 1, // Widest possible pool — capacity fit for the actual party is evaluated below (a party of 6 can still be seated by combining two tables the DB's own "capacity >= guestCount" single-table filter would otherwise exclude).
    });

    const fits = canSeatParty(tables, query.guestCount);
    const seatingOptions = Array.from(
      new Set(tables.map((t) => t.section?.name).filter((name): name is string => !!name)),
    ).sort();

    return { available: fits, seatingOptions };
  }

  /**
   * Creates a dine-in reservation for the authenticated diner. Auto-assigns
   * table(s) — the diner never picks a table id, only a party size and an
   * optional soft seating preference (spec § 10). Both the app-level
   * availability check inside `selectTables`/`findAvailableTables` AND the
   * database's `no_double_booking` EXCLUDE constraint (enforced inside
   * `ReservationService.createReservation`'s transaction) guard against a
   * race between two diners booking the same table concurrently — the
   * app-level check alone is TOCTOU-vulnerable, same caveat documented on
   * `ReservationService.createReservation` itself.
   */
  static async createReservation(
    publicCode: string,
    customerAccountId: string,
    input: CustomerCreateReservationInput,
  ) {
    const { organizationId, branchId } = await this.resolveStorefront(publicCode);
    const customer = await CustomerAccountService.getOrCreateCustomerProfile(
      organizationId,
      customerAccountId,
    );
    const account = await prisma.customerAccount.findUniqueOrThrow({ where: { id: customerAccountId } });

    const tables = await ReservationService.findAvailableTables(organizationId, branchId, {
      startAt: input.startAt,
      durationMinutes: input.durationMinutes,
      guestCount: 1,
    });

    const assignment = selectTables(tables, input.guestCount, input.seatingPreference);
    if (!assignment) {
      throw new ConflictError(
        `No tables are available to seat a party of ${input.guestCount} at that time. Try a different time or party size.`,
      );
    }

    const reservation = await ReservationService.createReservation(
      organizationId,
      branchId,
      {
        tableIds: assignment.tableIds,
        startAt: input.startAt,
        durationMinutes: input.durationMinutes,
        guestCount: input.guestCount,
        customerId: customer.id,
        guestName: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || account.firstName,
        guestEmail: customer.email ?? account.email ?? undefined,
        guestPhone: customer.phone ?? account.mobile ?? undefined,
        specialRequests: input.specialRequests,
        occasion: undefined,
        depositRequired: false,
      },
      // No staff actor — see the JSDoc on ReservationService.createReservation
      // for why a CustomerAccount id must never be passed here instead.
      null,
    );

    // The audit trail already written inside createReservation records
    // `userId: null` for this booking (honest — no staff actor); this
    // second, customer-scoped entry is what actually lets anyone trace
    // "which CustomerAccount made this booking" later, without ever
    // writing a CustomerAccount id into a column FK'd to `User`.
    await writeAuditLog(prisma, {
      organizationId,
      branchId,
      action: 'reservation.customer_create',
      entityType: 'Reservation',
      entityId: reservation.id,
      newValue: {
        customerAccountId,
        customerId: customer.id,
        seatingPreference: input.seatingPreference ?? null,
        seatingHonored: assignment.preferenceHonored,
        tableIds: assignment.tableIds,
      },
    });

    return { ...reservation, seatingPreferenceHonored: assignment.preferenceHonored };
  }

  /**
   * A diner's own reservation history at this restaurant (spec § 1 item 19,
   * "View reservation history"). Read-only — never creates a Customer row
   * (see `CustomerAccountService.findCustomerProfile`'s header), so a diner
   * who has never booked here sees a genuinely empty list, not an error.
   */
  static async list(
    publicCode: string,
    customerAccountId: string,
    query: CustomerListReservationsQueryInput,
  ) {
    const { organizationId } = await this.resolveStorefront(publicCode);
    const customer = await CustomerAccountService.findCustomerProfile(organizationId, customerAccountId);
    if (!customer) return [];

    return prisma.reservation.findMany({
      where: {
        organizationId,
        customerId: customer.id,
        ...(query.upcomingOnly ? { startAt: { gte: new Date() } } : {}),
      },
      include: { tables: { include: { table: true } } },
      orderBy: { startAt: 'desc' },
      take: query.take,
      skip: query.skip,
    });
  }

  /** Single reservation detail, scoped to the requesting diner — never another customer's booking, even within the same restaurant. */
  static async get(publicCode: string, customerAccountId: string, reservationId: string) {
    const { organizationId } = await this.resolveStorefront(publicCode);
    const customer = await CustomerAccountService.findCustomerProfile(organizationId, customerAccountId);
    if (!customer) throw new NotFoundError('Reservation');

    const reservation = await prisma.reservation.findFirst({
      where: { id: reservationId, organizationId, customerId: customer.id },
      include: { tables: { include: { table: true } } },
    });
    if (!reservation) throw new NotFoundError('Reservation');
    return reservation;
  }

  // --- helpers ------------------------------------------------------------

  // CAPP Phase 4: `resolveStorefront` used to be a private method here;
  // it's now `RestaurantDirectoryService.resolveStorefront` (shared with
  // `CustomerOrderService`, which needs the identical resolution) — see
  // that method's own header comment.
  private static resolveStorefront(publicCode: string) {
    return RestaurantDirectoryService.resolveStorefront(publicCode);
  }
}
