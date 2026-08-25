import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError } from '@/lib/utils/api-error';
import { CustomerService } from '@/services/crm/CustomerService';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import type { CreateCustomerAddressInput, UpdateCustomerAddressInput } from '@/lib/validation/crm';

/**
 * CAPP Phase 5 — a diner's saved delivery addresses (spec § 1 item 23,
 * "Save addresses"). Thin customer-facing wrapper around
 * `CustomerService.addAddress`/`updateAddress`/`deleteAddress` (Phase 8's
 * CRM address CRUD, unchanged) — same "reuse the staff transaction, never a
 * parallel pipeline" shape as `CustomerOrderService`/`CustomerReservationService`.
 *
 * Routing shape: restaurant-scoped (`/restaurants/[restaurantId]/addresses`),
 * not account-wide, because `CustomerAddress` FKs to the per-organization
 * `Customer` CRM row (see schema.prisma's "Phase 8 — CRM" comment), not to
 * the platform-wide `CustomerAccount` — an address a diner saves at
 * Restaurant A's storefront lives on Restaurant A's own Customer record and
 * was never visible to Restaurant B's staff or data anyway, so exposing it
 * only under that restaurant's own API surface matches the schema exactly
 * rather than inventing a cross-restaurant address book the data model
 * doesn't support.
 */
export class CustomerAddressService {
  /**
   * Read-only — never creates a Customer CRM row just because a diner
   * opened "My Addresses" (same reasoning as
   * `CustomerAccountService.findCustomerProfile`'s own header comment). A
   * diner who has never ordered/booked at this restaurant sees a genuinely
   * empty list, not an error.
   */
  static async list(publicCode: string, customerAccountId: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await CustomerAccountService.findCustomerProfile(organizationId, customerAccountId);
    if (!customer) return [];
    return prisma.customerAddress.findMany({
      where: { customerId: customer.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  static async create(publicCode: string, customerAccountId: string, input: CreateCustomerAddressInput) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await CustomerAccountService.getOrCreateCustomerProfile(organizationId, customerAccountId);
    // No staff actor — see CustomerService.addAddress's JSDoc for why a
    // CustomerAccount id must never be passed here instead.
    return CustomerService.addAddress(organizationId, customer.id, input, null);
  }

  /** Ownership enforced by resolving the caller's own Customer.id first — an addressId belonging to another customer 404s exactly like a nonexistent one (CustomerService.updateAddress's own scoping already guarantees this; asserted again here defensively via `assertOwnAddress`). */
  static async update(
    publicCode: string,
    customerAccountId: string,
    addressId: string,
    input: UpdateCustomerAddressInput,
  ) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await this.requireOwnCustomerProfile(organizationId, customerAccountId);
    await this.assertOwnAddress(customer.id, addressId);
    return CustomerService.updateAddress(organizationId, customer.id, addressId, input, null);
  }

  static async remove(publicCode: string, customerAccountId: string, addressId: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await this.requireOwnCustomerProfile(organizationId, customerAccountId);
    await this.assertOwnAddress(customer.id, addressId);
    return CustomerService.deleteAddress(organizationId, customer.id, addressId, null);
  }

  // --- helpers ------------------------------------------------------------

  /** Unlike `list`'s read-only lookup, update/delete need a real Customer.id to scope the ownership check against — a diner with no profile yet cannot own any address, so this 404s rather than silently creating one just to fail the next check anyway. */
  private static async requireOwnCustomerProfile(organizationId: string, customerAccountId: string) {
    const customer = await CustomerAccountService.findCustomerProfile(organizationId, customerAccountId);
    if (!customer) throw new NotFoundError('Address');
    return customer;
  }

  private static async assertOwnAddress(customerId: string, addressId: string) {
    const address = await prisma.customerAddress.findFirst({ where: { id: addressId, customerId } });
    if (!address) throw new NotFoundError('Address');
    return address;
  }
}
