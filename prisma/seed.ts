/**
 * Development / demo seed data — clearly not real business data.
 * Run with: npm run db:seed
 *
 * Creates: 1 organization ("Demo"-prefixed), 2 branches, and one user per
 * platform role, each seeded with that role's default permissions. Later
 * phases will extend this file with menu items, tables, reservations, etc.
 * as those tables are introduced — deliberately minimal for Phase 1.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATALOG,
  ROLE_NAMES,
} from '../lib/auth/constants';

const prisma = new PrismaClient();

const DEMO_ORG_EMAIL = 'demo-org@restaurant-platform.local';
const DEMO_PASSWORD = 'DemoPass123!';

async function main() {
  console.log('Seeding demo data (clearly marked, safe to delete)...');

  await Promise.all(
    PERMISSION_CATALOG.map((p) =>
      prisma.permission.upsert({
        where: { key: p.key },
        update: {},
        create: { key: p.key, description: p.description },
      }),
    ),
  );
  const permissions = await prisma.permission.findMany();
  const permissionByKey = new Map(permissions.map((p) => [p.key, p.id]));

  const organization = await prisma.organization.upsert({
    where: { email: DEMO_ORG_EMAIL },
    update: {},
    create: {
      name: '[DEMO] Manila Grill House',
      legalName: '[DEMO] Manila Grill House Food Corp.',
      email: DEMO_ORG_EMAIL,
      phone: '+63 2 8000 0000',
      currency: 'PHP',
      timezone: 'Asia/Manila',
    },
  });

  const [branchA, branchB] = await Promise.all([
    prisma.branch.upsert({
      where: { id: `${organization.id}-branch-makati` },
      update: {},
      create: {
        id: `${organization.id}-branch-makati`,
        organizationId: organization.id,
        name: '[DEMO] Makati Branch',
        address: '123 Ayala Ave, Makati City',
        phone: '+63 2 8000 0001',
        email: 'makati@restaurant-platform.local',
        timezone: 'Asia/Manila',
        status: 'ACTIVE',
      },
    }),
    prisma.branch.upsert({
      where: { id: `${organization.id}-branch-qc` },
      update: {},
      create: {
        id: `${organization.id}-branch-qc`,
        organizationId: organization.id,
        name: '[DEMO] Quezon City Branch',
        address: '456 Commonwealth Ave, Quezon City',
        phone: '+63 2 8000 0002',
        email: 'qc@restaurant-platform.local',
        timezone: 'Asia/Manila',
        status: 'ACTIVE',
      },
    }),
  ]);

  const roleRecords = await Promise.all(
    ROLE_NAMES.map((name) =>
      prisma.role.upsert({
        where: { organizationId_name: { organizationId: organization.id, name } },
        update: {},
        create: { organizationId: organization.id, name },
      }),
    ),
  );

  for (const role of roleRecords) {
    const grants = DEFAULT_ROLE_PERMISSIONS[role.name];
    for (const key of grants) {
      const permissionId = permissionByKey.get(key);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  for (const roleName of ROLE_NAMES) {
    const email = `${roleName.toLowerCase()}@restaurant-platform.local`;
    const user = await prisma.user.upsert({
      where: { organizationId_email: { organizationId: organization.id, email } },
      update: {},
      create: {
        organizationId: organization.id,
        email,
        passwordHash,
        firstName: '[Demo]',
        lastName: roleName.charAt(0) + roleName.slice(1).toLowerCase(),
        status: 'ACTIVE',
      },
    });
    const role = roleRecords.find((r) => r.name === roleName)!;
    const branchScope = roleName === 'MANAGER' ? branchA.id : null;
    await prisma.userRole.upsert({
      where: {
        userId_roleId_branchId: { userId: user.id, roleId: role.id, branchId: branchScope },
      },
      update: {},
      create: {
        userId: user.id,
        roleId: role.id,
        organizationId: organization.id,
        branchId: branchScope,
      },
    });
    console.log(`  seeded ${roleName} -> ${email}`);
  }

  console.log('\nDemo login (organization email + user email + password):');
  console.log(`  Organization email: ${DEMO_ORG_EMAIL}`);
  console.log(`  Any role email:     owner@restaurant-platform.local (or staff@, manager@, ...)`);
  console.log(`  Password:           ${DEMO_PASSWORD}`);
  console.log(`\nBranches: ${branchA.name}, ${branchB.name}`);
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
