import { prisma } from '@/lib/db/prisma';

/**
 * Wipes all tables between integration tests, in FK-safe order. Only ever
 * point DATABASE_URL (via .env.test) at a disposable test database — this
 * function is intentionally destructive.
 */
export async function resetDatabase() {
  await prisma.auditLog.deleteMany();
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
