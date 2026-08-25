import { prisma } from '@/lib/db/prisma';

/**
 * Wipes all tables between integration tests, in FK-safe order. Only ever
 * point DATABASE_URL (via .env.test) at a disposable test database — this
 * function is intentionally destructive.
 */
export async function resetDatabase() {
  await prisma.auditLog.deleteMany();
  // Phase 14 — notifications. Same cross-cutting-log shape as auditLog
  // above (organizationId/branchId FKs, no other table references it) —
  // deleted alongside it, before anything it could reference.
  await prisma.notification.deleteMany();
  // Phase 10 — accounting. Deleted first (before menuItem/branch/
  // organization/user further down): expenseAttachment references expense;
  // expense references vendor/expenseCategory/journalEntry (all SET NULL or
  // RESTRICT-free from this direction) plus organization/branch/user
  // directly; financialTransaction and journalEntryLine both reference
  // journalEntry (Cascade); journalEntry itself references accountingPeriod
  // (RESTRICT) and chartOfAccount indirectly through its lines (RESTRICT via
  // journalEntryLine.accountId) — so lines/entries go before periods/
  // accounts, exactly mirroring Phase 9's inventoryTransaction-before-unit
  // ordering for the same RESTRICT reason.
  await prisma.expenseAttachment.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.financialTransaction.deleteMany();
  await prisma.journalEntryLine.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.accountingPeriod.deleteMany();
  await prisma.expenseCategory.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.chartOfAccount.deleteMany();
  // Phase 9 — inventory. Deleted first (before menuItem/branch/organization/
  // user further down): wasteRecord/stockCountItem/inventoryTransaction all
  // reference inventoryItem, so those go before it; purchaseOrderItem
  // references purchaseOrder; recipeItem references recipe (which in turn
  // references menuItem, still alive at this point); ingredient references
  // its stockUnit (a Unit, RESTRICT), so ingredients go before units.
  await prisma.wasteRecord.deleteMany();
  await prisma.stockCountItem.deleteMany();
  await prisma.stockCount.deleteMany();
  await prisma.inventoryTransaction.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.recipeItem.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.ingredient.deleteMany();
  await prisma.unit.deleteMany();
  // CAPP Phases 8-11 — promotions/campaigns, notifications, loyalty/
  // favorites/upselling, analytics (spec § 16-41, § 57). Added CAPP Phase 12
  // hardening — these tables shipped across four phases without ever being
  // added here, so every integration test written against them would have
  // accumulated cross-test pollution instead of getting a clean slate.
  // Deleted first, in FK-child-before-parent order: campaignAudience/
  // notificationDelivery before their respective parents; customerNotification/
  // promotionRedemption/customerPromotion before customerAccount, customer,
  // organization, and promotionCampaign; promotionCampaign before promotion;
  // loyaltyTransaction before loyaltyAccount; customerFavorite/
  // menuItemRecommendation before menuItem/order (both deleted later in this
  // function); customerAnalyticsEvent/customerPushToken before
  // customerAccount. PromotionRedemption in particular must precede
  // `customer.deleteMany()` just below it (its own FK is to Customer, the
  // CRM model, not CustomerAccount) — the reason this whole block sits
  // before the Phase 8 CRM block rather than down by CAPP Phase 1's, even
  // though most of its other FKs only require it to precede that block.
  await prisma.campaignAudience.deleteMany();
  await prisma.notificationDelivery.deleteMany();
  await prisma.customerNotification.deleteMany();
  await prisma.promotionRedemption.deleteMany();
  await prisma.customerPromotion.deleteMany();
  await prisma.promotionCampaign.deleteMany();
  await prisma.promotion.deleteMany();
  await prisma.loyaltyTransaction.deleteMany();
  await prisma.loyaltyAccount.deleteMany();
  await prisma.customerFavorite.deleteMany();
  await prisma.menuItemRecommendation.deleteMany();
  await prisma.customerAnalyticsEvent.deleteMany();
  await prisma.customerPushToken.deleteMany();
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
  // CAPP Phase 1 — customer mobile app identity. customer (just above)
  // references customerAccount (SET NULL) so it's already gone by this
  // point; customerRefreshToken and customerNotificationPreference both
  // Cascade from customerAccount, so they go before it. platformSequence
  // and restaurantBranding/realtimeEvent have no dependents and could live
  // anywhere, grouped here for locality with the rest of this feature.
  await prisma.customerRefreshToken.deleteMany();
  await prisma.customerNotificationPreference.deleteMany();
  await prisma.customerAccount.deleteMany();
  await prisma.platformSequence.deleteMany();
  await prisma.restaurantBranding.deleteMany();
  await prisma.realtimeEvent.deleteMany();
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
