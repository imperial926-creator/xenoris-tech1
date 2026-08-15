import { prisma } from '@/lib/db/prisma';

/**
 * Wipes all tables between integration tests, in FK-safe order. Only ever
 * point DATABASE_URL (via .env.test) at a disposable test database — this
 * function is intentionally destructive.
 */
export async function resetDatabase() {
  await prisma.auditLog.deleteMany();
  // Phase 8 — CRM. Deleted first: customerReview references order/
  // reservation/cateringEvent/customer/branch/organization/user, and
  // customer itself is referenced (SET NULL, not blocking) from orders/
  // reservations/catering_inquiries/catering_events — deleting these before
  // any of those sidesteps FK-ordering assumptions entirely rather than
  // relying on SET NULL semantics to save the day.
  await prisma.customerReview.deleteMany();
  await prisma.customerTag.deleteMany();
  await prisma.customerNote.deleteMany();
  await prisma.customerPreference.deleteMany();
  await prisma.customerAddress.deleteMany();
  await prisma.customer.deleteMany();
  // Phase 6 — delivery. Deleted before orders/users/branches, since
  // driverAssignment/deliveryStatusHistory/deliveryOrder reference order,
  // and driver/deliveryZone reference user/branch.
  await prisma.driverAssignment.deleteMany();
  await prisma.deliveryStatusHistory.deleteMany();
  await prisma.deliveryOrder.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.deliveryZone.deleteMany();
  // Phase 7 — catering. Deleted before users/branches, since
  // cateringEvent/cateringInquiry reference user (customerUserId).
  await prisma.cateringPayment.deleteMany();
  await prisma.cateringEventItem.deleteMany();
  await prisma.cateringEvent.deleteMany();
  await prisma.cateringQuoteItem.deleteMany();
  await prisma.cateringQuote.deleteMany();
  await prisma.cateringInquiry.deleteMany();
  await prisma.cateringPackage.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.invoiceSequence.deleteMany();
  await prisma.orderItemModifier.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.orderStatusHistory.deleteMany();
  await prisma.orderPayment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.reservationStatusHistory.deleteMany();
  await prisma.reservationTable.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.tableStatusHistory.deleteMany();
  await prisma.restaurantTable.deleteMany();
  await prisma.tableSection.deleteMany();
  await prisma.menuItemModifierGroup.deleteMany();
  await prisma.menuModifier.deleteMany();
  await prisma.menuModifierGroup.deleteMany();
  await prisma.menuItemVariant.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.menuCategory.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.role.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.permission.deleteMany();
}
