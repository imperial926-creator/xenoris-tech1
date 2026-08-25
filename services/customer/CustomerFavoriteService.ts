import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError } from '@/lib/utils/api-error';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { ORDER_INCLUDE } from '@/services/orders/OrderService';
import type { ListFavoritesQueryInput } from '@/lib/validation/customer-favorite';

/**
 * CAPP Phase 10 — spec § 38 "Favorite items" / "Favorite orders," both
 * backed by the single `CustomerFavorite` table (menuItemId XOR orderId —
 * see its schema.prisma comment). Same "every method requires a signed-in
 * diner" boundary as `CustomerNotificationService` — a favorites list is
 * inherently per-account.
 */
export class CustomerFavoriteService {
  // --- menu items -----------------------------------------------------------

  static async listFavoriteItems(publicCode: string, customerAccountId: string, query: ListFavoritesQueryInput) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const rows = await prisma.customerFavorite.findMany({
      where: { organizationId, customerAccountId, menuItemId: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: { menuItem: { include: { variants: true } } },
      take: query.take,
      skip: query.skip,
    });
    // Favoriting an item that's since gone inactive/unavailable isn't an
    // error — the diner still sees it in their list (same "history isn't
    // rewritten" principle as a past order referencing a since-changed
    // item), just with `available` telling the client whether to let them
    // add it to a new cart from here.
    return rows
      .filter((r) => r.menuItem)
      .map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        menuItem: r.menuItem!,
        available: Boolean(r.menuItem!.active && r.menuItem!.available),
      }));
  }

  static async addFavoriteItem(publicCode: string, customerAccountId: string, menuItemId: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const menuItem = await prisma.menuItem.findFirst({ where: { id: menuItemId, organizationId } });
    if (!menuItem) throw new NotFoundError('Menu item');
    return prisma.customerFavorite.upsert({
      where: { customerAccountId_menuItemId: { customerAccountId, menuItemId } },
      create: { organizationId, customerAccountId, menuItemId },
      update: {},
    });
  }

  static async removeFavoriteItem(publicCode: string, customerAccountId: string, menuItemId: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const existing = await prisma.customerFavorite.findFirst({ where: { organizationId, customerAccountId, menuItemId } });
    if (!existing) return { success: true as const };
    await prisma.customerFavorite.delete({ where: { id: existing.id } });
    return { success: true as const };
  }

  // --- orders -----------------------------------------------------------------

  static async listFavoriteOrders(publicCode: string, customerAccountId: string, query: ListFavoritesQueryInput) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const rows = await prisma.customerFavorite.findMany({
      where: { organizationId, customerAccountId, orderId: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: { order: { include: ORDER_INCLUDE } },
      take: query.take,
      skip: query.skip,
    });
    return rows.filter((r) => r.order).map((r) => ({ id: r.id, createdAt: r.createdAt, order: r.order! }));
  }

  /** Only a past order this diner actually placed can be favorited — same ownership check `CustomerOrderService.get` already makes. */
  static async addFavoriteOrder(publicCode: string, customerAccountId: string, orderId: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const customer = await CustomerAccountService.findCustomerProfile(organizationId, customerAccountId);
    const order = customer
      ? await prisma.order.findFirst({ where: { id: orderId, organizationId, customerId: customer.id } })
      : null;
    if (!order) throw new NotFoundError('Order');
    return prisma.customerFavorite.upsert({
      where: { customerAccountId_orderId: { customerAccountId, orderId } },
      create: { organizationId, customerAccountId, orderId },
      update: {},
    });
  }

  static async removeFavoriteOrder(publicCode: string, customerAccountId: string, orderId: string) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    const existing = await prisma.customerFavorite.findFirst({ where: { organizationId, customerAccountId, orderId } });
    if (!existing) return { success: true as const };
    await prisma.customerFavorite.delete({ where: { id: existing.id } });
    return { success: true as const };
  }
}
