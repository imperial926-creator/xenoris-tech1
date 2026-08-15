/**
 * Development / demo seed data — clearly not real business data.
 * Run with: npm run db:seed
 *
 * Creates: 1 organization ("[DEMO]"-prefixed), 2 branches, one user per
 * platform role, table sections/tables per branch, and a starter menu with
 * categories, items, a variant, and modifier groups. Later phases will
 * extend this further (reservations, orders, inventory, ...) as those
 * tables are introduced.
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

  // --- Phase 2: table sections + tables, per branch ------------------------
  for (const branch of [branchA, branchB]) {
    const sections = await Promise.all(
      ['Main Dining', 'Patio'].map((name) =>
        prisma.tableSection.upsert({
          where: { branchId_name: { branchId: branch.id, name } },
          update: {},
          create: { organizationId: organization.id, branchId: branch.id, name },
        }),
      ),
    );

    // 6 tables per section = 12 per branch = 24 total across both branches.
    for (const section of sections) {
      for (let i = 1; i <= 6; i++) {
        const tableNumber = `${section.name === 'Main Dining' ? 'M' : 'P'}${i}`;
        const table = await prisma.restaurantTable.upsert({
          where: { branchId_tableNumber: { branchId: branch.id, tableNumber } },
          update: {},
          create: {
            organizationId: organization.id,
            branchId: branch.id,
            sectionId: section.id,
            tableNumber,
            capacity: i % 3 === 0 ? 8 : i % 2 === 0 ? 2 : 4,
          },
        });
        const historyExists = await prisma.tableStatusHistory.findFirst({
          where: { tableId: table.id },
        });
        if (!historyExists) {
          await prisma.tableStatusHistory.create({
            data: { tableId: table.id, fromStatus: null, toStatus: table.status },
          });
        }
      }
    }
    console.log(`  seeded ${sections.length} sections / 12 tables -> ${branch.name}`);
  }

  // --- Phase 2: menu ---------------------------------------------------------
  const categoryDefs = [
    { name: '[DEMO] Rice Meals', order: 1 },
    { name: '[DEMO] Grilled & Barbecue', order: 2 },
    { name: '[DEMO] Drinks', order: 3 },
    { name: '[DEMO] Desserts', order: 4 },
  ];
  const categories = await Promise.all(
    categoryDefs.map((c) =>
      prisma.menuCategory.upsert({
        where: { organizationId_name: { organizationId: organization.id, name: c.name } },
        update: {},
        create: { organizationId: organization.id, name: c.name, displayOrder: c.order },
      }),
    ),
  );
  const categoryByName = new Map<string, (typeof categories)[number]>();
  for (const c of categories) categoryByName.set(c.name, c);

  const itemDefs: Array<{
    category: string;
    name: string;
    price: string;
    cost: string;
    prep: number;
  }> = [
    { category: '[DEMO] Rice Meals', name: 'Chicken Inasal Meal', price: '195.00', cost: '85.00', prep: 12 },
    { category: '[DEMO] Rice Meals', name: 'Beef Tapa Meal', price: '210.00', cost: '95.00', prep: 12 },
    { category: '[DEMO] Rice Meals', name: 'Pork Sisig Meal', price: '220.00', cost: '100.00', prep: 15 },
    { category: '[DEMO] Rice Meals', name: 'Bangus Belly Meal', price: '230.00', cost: '110.00', prep: 15 },
    { category: '[DEMO] Grilled & Barbecue', name: 'Pork BBQ Skewer (3pc)', price: '150.00', cost: '60.00', prep: 18 },
    { category: '[DEMO] Grilled & Barbecue', name: 'Grilled Liempo', price: '260.00', cost: '120.00', prep: 20 },
    { category: '[DEMO] Grilled & Barbecue', name: 'Grilled Bangus', price: '240.00', cost: '115.00', prep: 20 },
    { category: '[DEMO] Drinks', name: 'Iced Tea', price: '60.00', cost: '15.00', prep: 3 },
    { category: '[DEMO] Drinks', name: 'Calamansi Juice', price: '65.00', cost: '18.00', prep: 3 },
    { category: '[DEMO] Drinks', name: 'Bottled Water', price: '40.00', cost: '12.00', prep: 1 },
    { category: '[DEMO] Drinks', name: 'Soda', price: '55.00', cost: '20.00', prep: 1 },
    { category: '[DEMO] Desserts', name: 'Halo-Halo', price: '135.00', cost: '55.00', prep: 8 },
    { category: '[DEMO] Desserts', name: 'Leche Flan', price: '90.00', cost: '35.00', prep: 3 },
    { category: '[DEMO] Desserts', name: 'Buko Pandan', price: '95.00', cost: '38.00', prep: 5 },
  ];

  const itemByName = new Map<string, Awaited<ReturnType<typeof prisma.menuItem.create>>>();
  for (const def of itemDefs) {
    const category = categoryByName.get(def.category)!;
    const item = await prisma.menuItem.upsert({
      where: {
        // menu_items has no natural unique key besides id — findFirst then
        // create/skip, since Prisma upsert requires a unique `where`.
        id: `${organization.id}-item-${def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      },
      update: {},
      create: {
        id: `${organization.id}-item-${def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        organizationId: organization.id,
        categoryId: category.id,
        name: def.name,
        price: def.price,
        cost: def.cost,
        preparationTimeMinutes: def.prep,
      },
    });
    itemByName.set(def.name, item);
  }
  console.log(`  seeded ${categories.length} categories / ${itemDefs.length} menu items`);

  // One variant, to prove menu_item_variants works end to end.
  const chickenInasal = itemByName.get('Chicken Inasal Meal')!;
  await prisma.menuItemVariant.upsert({
    where: { menuItemId_name: { menuItemId: chickenInasal.id, name: 'Double Order' } },
    update: {},
    create: { menuItemId: chickenInasal.id, name: 'Double Order', price: '340.00', cost: '160.00' },
  });

  // Two modifier groups: "Size" (choose one, required) on rice meals, and
  // "Add-ons" (choose any) on the same item, to demonstrate both selection
  // types and their linkage.
  const sizeGroup = await prisma.menuModifierGroup.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: 'Rice Size' } },
    update: {},
    create: {
      organizationId: organization.id,
      name: 'Rice Size',
      selectionType: 'SINGLE',
      required: true,
      minSelect: 1,
      maxSelect: 1,
    },
  });
  await Promise.all(
    [
      { name: 'Regular Rice', priceDelta: '0.00' },
      { name: 'Extra Rice', priceDelta: '25.00' },
    ].map((m) =>
      prisma.menuModifier.upsert({
        where: { modifierGroupId_name: { modifierGroupId: sizeGroup.id, name: m.name } },
        update: {},
        create: { modifierGroupId: sizeGroup.id, name: m.name, priceDelta: m.priceDelta },
      }),
    ),
  );

  const addOnsGroup = await prisma.menuModifierGroup.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: 'Add-ons' } },
    update: {},
    create: { organizationId: organization.id, name: 'Add-ons', selectionType: 'MULTIPLE', minSelect: 0, maxSelect: 3 },
  });
  await Promise.all(
    [
      { name: 'Extra Egg', priceDelta: '20.00' },
      { name: 'Extra Sauce', priceDelta: '10.00' },
    ].map((m) =>
      prisma.menuModifier.upsert({
        where: { modifierGroupId_name: { modifierGroupId: addOnsGroup.id, name: m.name } },
        update: {},
        create: { modifierGroupId: addOnsGroup.id, name: m.name, priceDelta: m.priceDelta },
      }),
    ),
  );

  for (const group of [sizeGroup, addOnsGroup]) {
    const existingLink = await prisma.menuItemModifierGroup.findUnique({
      where: { menuItemId_modifierGroupId: { menuItemId: chickenInasal.id, modifierGroupId: group.id } },
    });
    if (!existingLink) {
      await prisma.menuItemModifierGroup.create({
        data: { menuItemId: chickenInasal.id, modifierGroupId: group.id },
      });
    }
  }
  console.log('  seeded 2 modifier groups (Rice Size, Add-ons) linked to Chicken Inasal Meal');

  // --- Phase 3: reservations, across every status -----------------------
  // Fixed offsets from "now" (seed time) rather than fixed calendar dates,
  // so PENDING/CONFIRMED demo bookings are always in the future and
  // COMPLETED/CANCELLED/NO_SHOW ones are always in the past, no matter when
  // `npm run db:seed` is actually run.
  const now = new Date();
  const atOffset = (days: number, hour: number, minute = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const plusMinutes = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60 * 1000);

  async function getTable(branchId: string, tableNumber: string) {
    return prisma.restaurantTable.findUniqueOrThrow({ where: { branchId_tableNumber: { branchId, tableNumber } } });
  }

  interface ReservationSeed {
    slug: string;
    branchId: string;
    tableNumber: string;
    guestName: string;
    guestPhone?: string;
    guestEmail?: string;
    guestCount: number;
    startAt: Date;
    durationMinutes: number;
    status: 'PENDING' | 'CONFIRMED' | 'SEATED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
    occasion?: string;
    specialRequests?: string;
    depositRequired?: boolean;
    depositAmount?: string;
    depositStatus?: 'NONE' | 'PENDING' | 'PAID' | 'REFUNDED';
    depositNote?: string;
    cancellationReason?: string;
  }

  const reservationDefs: ReservationSeed[] = [
    {
      slug: 'pending-tomorrow',
      branchId: branchA.id,
      tableNumber: 'M1',
      guestName: '[DEMO] Juan Dela Cruz',
      guestPhone: '+63 917 000 0001',
      guestCount: 2,
      startAt: atOffset(1, 18, 0),
      durationMinutes: 90,
      status: 'PENDING',
    },
    {
      slug: 'confirmed-tomorrow-deposit',
      branchId: branchA.id,
      tableNumber: 'M2',
      guestName: '[DEMO] Maria Santos',
      guestPhone: '+63 917 000 0002',
      guestEmail: 'maria.santos.demo@example.com',
      guestCount: 4,
      startAt: atOffset(1, 19, 30),
      durationMinutes: 120,
      status: 'CONFIRMED',
      occasion: 'Anniversary',
      depositRequired: true,
      depositAmount: '500.00',
      depositStatus: 'PAID',
      depositNote: '[DEMO] Paid via GCash, confirmed by phone.',
    },
    {
      slug: 'seated-today',
      branchId: branchA.id,
      tableNumber: 'M3',
      guestName: '[DEMO] Walk-in Party',
      guestCount: 3,
      startAt: atOffset(0, 12, 0),
      durationMinutes: 90,
      status: 'SEATED',
      specialRequests: 'High chair for a toddler.',
    },
    {
      slug: 'completed-yesterday',
      branchId: branchA.id,
      tableNumber: 'M4',
      guestName: '[DEMO] Ramon Reyes',
      guestPhone: '+63 917 000 0004',
      guestCount: 5,
      startAt: atOffset(-1, 19, 0),
      durationMinutes: 120,
      status: 'COMPLETED',
      occasion: 'Birthday',
      depositRequired: true,
      depositAmount: '1000.00',
      depositStatus: 'PAID',
      depositNote: '[DEMO] Cash deposit collected at booking.',
    },
    {
      slug: 'cancelled-upcoming',
      branchId: branchA.id,
      tableNumber: 'M5',
      guestName: '[DEMO] Liza Fernandez',
      guestPhone: '+63 917 000 0005',
      guestCount: 2,
      startAt: atOffset(2, 20, 0),
      durationMinutes: 90,
      status: 'CANCELLED',
      cancellationReason: '[DEMO] Guest rescheduled to a later date.',
    },
    {
      slug: 'no-show-yesterday',
      branchId: branchA.id,
      tableNumber: 'M6',
      guestName: '[DEMO] Carlo Bautista',
      guestPhone: '+63 917 000 0006',
      guestCount: 2,
      startAt: atOffset(-1, 20, 0),
      durationMinutes: 90,
      status: 'NO_SHOW',
    },
    {
      slug: 'pending-qc',
      branchId: branchB.id,
      tableNumber: 'P1',
      guestName: '[DEMO] Grace Villanueva',
      guestPhone: '+63 917 000 0007',
      guestCount: 2,
      startAt: atOffset(3, 18, 30),
      durationMinutes: 90,
      status: 'PENDING',
    },
  ];

  let reservationCount = 0;
  for (const def of reservationDefs) {
    const table = await getTable(def.branchId, def.tableNumber);
    const endAt = plusMinutes(def.startAt, def.durationMinutes);
    const id = `${organization.id}-reservation-${def.slug}`;

    const reservation = await prisma.reservation.upsert({
      where: { id },
      update: {},
      create: {
        id,
        organizationId: organization.id,
        branchId: def.branchId,
        guestName: def.guestName,
        guestPhone: def.guestPhone,
        guestEmail: def.guestEmail,
        guestCount: def.guestCount,
        startAt: def.startAt,
        endAt,
        status: def.status,
        occasion: def.occasion,
        specialRequests: def.specialRequests,
        depositRequired: def.depositRequired ?? false,
        depositAmount: def.depositAmount,
        depositStatus: def.depositStatus ?? 'NONE',
        depositNote: def.depositNote,
        cancellationReason: def.cancellationReason,
        cancelledAt: def.status === 'CANCELLED' ? now : undefined,
      },
    });

    const rtId = `${id}-table`;
    await prisma.reservationTable.upsert({
      where: { id: rtId },
      update: {},
      create: {
        id: rtId,
        reservationId: reservation.id,
        tableId: table.id,
        startAt: def.startAt,
        endAt,
        // Denormalized status must match the reservation's status — see
        // schema.prisma's "Phase 3 — Reservations" comment for why.
        status: def.status,
      },
    });

    const historyExists = await prisma.reservationStatusHistory.findFirst({
      where: { reservationId: reservation.id },
    });
    if (!historyExists) {
      await prisma.reservationStatusHistory.create({
        data: { reservationId: reservation.id, fromStatus: null, toStatus: def.status },
      });
    }
    reservationCount += 1;
  }
  console.log(`  seeded ${reservationCount} reservations across PENDING/CONFIRMED/SEATED/COMPLETED/CANCELLED/NO_SHOW`);

  // --- Phase 4: orders, order items/modifiers, payments, one invoice -------
  // Hand-computed totals (not run through OrderService — this is direct
  // Prisma seeding, same as every other seed block) using the same rule
  // OrderService applies: 12% provisional VAT on STANDARD-taxCategory items
  // (all seeded menu items default to STANDARD), applied to lineTotal
  // (unit price × quantity, plus modifiers × quantity).
  interface SeedOrderItem {
    itemName: string;
    quantity: number;
    modifierNames?: string[];
  }
  interface SeedOrder {
    slug: string;
    branchId: string;
    type: 'DINE_IN' | 'TAKEOUT' | 'DELIVERY';
    status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
    tableNumber?: string;
    deliveryAddress?: string;
    guestName?: string;
    guestPhone?: string;
    guestEmail?: string;
    items: SeedOrderItem[];
    payment?: { method: 'CASH' | 'CARD' | 'GCASH' | 'MAYA' | 'BANK_TRANSFER' | 'OTHER'; note?: string };
    cancellationReason?: string;
    issueInvoice?: boolean;
    // Phase 5: optional "have this ready by" time, offset from seed time
    // (see `now` below) the same way reservation offsets are computed, so
    // the kitchen board has one overdue and one on-time example without
    // hand-editing timestamps that would go stale.
    requiredAtOffsetMinutes?: number;
  }

  const orderDefs: SeedOrder[] = [
    {
      slug: 'dine-in-completed',
      branchId: branchA.id,
      type: 'DINE_IN',
      status: 'COMPLETED',
      tableNumber: 'M2',
      guestName: '[DEMO] Dine-in Guest',
      items: [
        { itemName: 'Chicken Inasal Meal', quantity: 2, modifierNames: ['Extra Rice', 'Extra Egg'] },
        { itemName: 'Iced Tea', quantity: 1 },
      ],
      payment: { method: 'CASH', note: '[DEMO] Paid in full at the table.' },
      issueInvoice: true,
    },
    {
      slug: 'takeout-ready',
      branchId: branchA.id,
      type: 'TAKEOUT',
      status: 'READY',
      guestName: '[DEMO] Takeout Guest',
      guestPhone: '+63 917 000 0010',
      items: [
        { itemName: 'Beef Tapa Meal', quantity: 1 },
        { itemName: 'Bottled Water', quantity: 1 },
      ],
      // Was needed 20 minutes ago and is still sitting READY — the kitchen
      // board's overdue indicator should be visibly triggered by this one.
      requiredAtOffsetMinutes: -20,
    },
    {
      slug: 'delivery-preparing',
      branchId: branchA.id,
      type: 'DELIVERY',
      status: 'PREPARING',
      deliveryAddress: '[DEMO] 123 Sample St, Makati City',
      guestName: '[DEMO] Delivery Guest',
      guestPhone: '+63 917 000 0011',
      guestEmail: 'delivery.guest.demo@example.com',
      items: [
        { itemName: 'Pork Sisig Meal', quantity: 1 },
        { itemName: 'Soda', quantity: 1 },
      ],
      // Still on time — the kitchen board should NOT flag this one.
      requiredAtOffsetMinutes: 30,
    },
    {
      slug: 'dine-in-pending',
      branchId: branchA.id,
      type: 'DINE_IN',
      status: 'PENDING',
      tableNumber: 'M5',
      items: [{ itemName: 'Grilled Liempo', quantity: 1 }],
    },
    {
      slug: 'takeout-cancelled',
      branchId: branchA.id,
      type: 'TAKEOUT',
      status: 'CANCELLED',
      guestName: '[DEMO] Cancelled Guest',
      items: [{ itemName: 'Halo-Halo', quantity: 1 }],
      cancellationReason: '[DEMO] Guest changed their mind.',
    },
    {
      slug: 'dine-in-qc-confirmed',
      branchId: branchB.id,
      type: 'DINE_IN',
      status: 'CONFIRMED',
      tableNumber: 'P1',
      items: [
        { itemName: 'Leche Flan', quantity: 2 },
        { itemName: 'Calamansi Juice', quantity: 1 },
      ],
    },
  ];

  const VAT_RATE = 0.12;
  const modifierByGroupAndName = new Map<string, { id: string; priceDelta: string }>([
    ['Extra Rice', { id: (await prisma.menuModifier.findUniqueOrThrow({ where: { modifierGroupId_name: { modifierGroupId: sizeGroup.id, name: 'Extra Rice' } } })).id, priceDelta: '25.00' }],
    ['Extra Egg', { id: (await prisma.menuModifier.findUniqueOrThrow({ where: { modifierGroupId_name: { modifierGroupId: addOnsGroup.id, name: 'Extra Egg' } } })).id, priceDelta: '20.00' }],
  ]);

  let orderCount = 0;
  let invoiceCount = 0;
  for (const def of orderDefs) {
    const id = `${organization.id}-order-${def.slug}`;
    let table: { id: string } | null = null;
    if (def.tableNumber) table = await getTable(def.branchId, def.tableNumber);

    let subtotal = 0;
    const lineData: Array<{
      itemName: string;
      menuItemId: string;
      unitPrice: number;
      quantity: number;
      modifiersTotal: number;
      lineSubtotal: number;
      lineTotal: number;
      modifierNames: string[];
    }> = [];
    for (const line of def.items) {
      const item = itemByName.get(line.itemName)!;
      const unitPrice = Number(item.price);
      const modifierNames = line.modifierNames ?? [];
      const modifierUnitTotal = modifierNames.reduce(
        (sum, name) => sum + Number(modifierByGroupAndName.get(name)!.priceDelta),
        0,
      );
      const lineSubtotal = unitPrice * line.quantity;
      const modifiersTotal = modifierUnitTotal * line.quantity;
      const lineTotal = lineSubtotal + modifiersTotal;
      subtotal += lineTotal;
      lineData.push({
        itemName: line.itemName,
        menuItemId: item.id,
        unitPrice,
        quantity: line.quantity,
        modifiersTotal,
        lineSubtotal,
        lineTotal,
        modifierNames,
      });
    }
    const taxTotal = Math.round(subtotal * VAT_RATE * 100) / 100;
    const total = Math.round((subtotal + taxTotal) * 100) / 100;

    const order = await prisma.order.upsert({
      where: { id },
      update: {},
      create: {
        id,
        organizationId: organization.id,
        branchId: def.branchId,
        type: def.type,
        status: def.status,
        tableId: table?.id,
        guestName: def.guestName,
        guestPhone: def.guestPhone,
        guestEmail: def.guestEmail,
        deliveryAddress: def.deliveryAddress,
        subtotal: subtotal.toFixed(2),
        taxTotal: taxTotal.toFixed(2),
        discountTotal: '0.00',
        total: total.toFixed(2),
        cancellationReason: def.cancellationReason,
        cancelledAt: def.status === 'CANCELLED' ? now : undefined,
        requiredAt:
          def.requiredAtOffsetMinutes !== undefined
            ? new Date(now.getTime() + def.requiredAtOffsetMinutes * 60 * 1000)
            : undefined,
      },
    });

    for (const [idx, line] of lineData.entries()) {
      const itemId = `${id}-item-${idx}`;
      const orderItem = await prisma.orderItem.upsert({
        where: { id: itemId },
        update: {},
        create: {
          id: itemId,
          orderId: order.id,
          menuItemId: line.menuItemId,
          nameSnapshot: line.itemName,
          unitPriceSnapshot: line.unitPrice.toFixed(2),
          quantity: line.quantity,
          lineSubtotal: line.lineSubtotal.toFixed(2),
          modifiersTotal: line.modifiersTotal.toFixed(2),
          lineTotal: line.lineTotal.toFixed(2),
        },
      });
      for (const [midx, modName] of line.modifierNames.entries()) {
        const mod = modifierByGroupAndName.get(modName)!;
        const modId = `${itemId}-mod-${midx}`;
        await prisma.orderItemModifier.upsert({
          where: { id: modId },
          update: {},
          create: {
            id: modId,
            orderItemId: orderItem.id,
            modifierId: mod.id,
            nameSnapshot: modName,
            priceDeltaSnapshot: mod.priceDelta,
          },
        });
      }
    }

    const histExists = await prisma.orderStatusHistory.findFirst({ where: { orderId: order.id } });
    if (!histExists) {
      await prisma.orderStatusHistory.create({
        data: { orderId: order.id, fromStatus: null, toStatus: def.status },
      });
    }

    if (def.payment) {
      const payId = `${id}-payment`;
      await prisma.orderPayment.upsert({
        where: { id: payId },
        update: {},
        create: {
          id: payId,
          organizationId: organization.id,
          orderId: order.id,
          method: def.payment.method,
          amount: total.toFixed(2),
          status: 'COMPLETED',
          note: def.payment.note,
        },
      });
    }

    if (def.issueInvoice) {
      const seqId = `${def.branchId}-invoice-seq`;
      const sequence = await prisma.invoiceSequence.upsert({
        where: { branchId: def.branchId },
        update: {},
        create: { id: seqId, organizationId: organization.id, branchId: def.branchId, lastNumber: 1 },
      });
      const invoiceNumber = `INV-${String(sequence.lastNumber).padStart(6, '0')}`;
      const invId = `${id}-invoice`;
      const invoice = await prisma.invoice.upsert({
        where: { id: invId },
        update: {},
        create: {
          id: invId,
          organizationId: organization.id,
          branchId: def.branchId,
          orderId: order.id,
          invoiceNumber,
          subtotal: subtotal.toFixed(2),
          taxTotal: taxTotal.toFixed(2),
          discountTotal: '0.00',
          total: total.toFixed(2),
        },
      });
      for (const [idx, line] of lineData.entries()) {
        const invItemId = `${invId}-item-${idx}`;
        await prisma.invoiceItem.upsert({
          where: { id: invItemId },
          update: {},
          create: {
            id: invItemId,
            invoiceId: invoice.id,
            nameSnapshot: line.itemName,
            unitPriceSnapshot: line.unitPrice.toFixed(2),
            quantity: line.quantity,
            lineTotal: line.lineTotal.toFixed(2),
            modifiersSummary: line.modifierNames.join(', ') || null,
          },
        });
      }
      invoiceCount += 1;
    }

    orderCount += 1;
  }
  console.log(`  seeded ${orderCount} orders across DINE_IN/TAKEOUT/DELIVERY and every status, ${invoiceCount} invoice(s)`);

  // --- Phase 6: delivery zones, a driver profile, one dispatched delivery --
  // Two zones per branch so the Delivery board has real data to manage, a
  // Driver profile for the already-seeded DRIVER-role demo user (created in
  // the per-role loop above), and — the meaningful part — retrofitting the
  // Phase 4 "delivery-preparing" seed order with a real zone/fee so it
  // demonstrates the actual point of Phase 6: the fee flows into the
  // order's total, not just decoration on a delivery record.
  const zoneDefs: Array<{ branchId: string; name: string; deliveryFee: string }> = [
    { branchId: branchA.id, name: '[DEMO] Downtown', deliveryFee: '50.00' },
    { branchId: branchA.id, name: '[DEMO] North District', deliveryFee: '80.00' },
    { branchId: branchB.id, name: '[DEMO] City Center', deliveryFee: '60.00' },
  ];
  const zoneByName = new Map<string, { id: string; deliveryFee: string }>();
  for (const def of zoneDefs) {
    const zone = await prisma.deliveryZone.upsert({
      where: { branchId_name: { branchId: def.branchId, name: def.name } },
      update: {},
      create: { organizationId: organization.id, branchId: def.branchId, name: def.name, deliveryFee: def.deliveryFee },
    });
    zoneByName.set(def.name, { id: zone.id, deliveryFee: def.deliveryFee });
  }
  console.log(`  seeded ${zoneDefs.length} delivery zones`);

  const driverUser = await prisma.user.findFirstOrThrow({
    where: { organizationId: organization.id, email: 'driver@restaurant-platform.local' },
  });
  const driver = await prisma.driver.upsert({
    where: { userId: driverUser.id },
    update: {},
    create: {
      organizationId: organization.id,
      branchId: branchA.id,
      userId: driverUser.id,
      vehicleType: 'Motorcycle',
      vehiclePlate: '[DEMO] ABC-1234',
    },
  });
  console.log(`  seeded 1 driver profile -> ${driverUser.email}`);

  const downtownZone = zoneByName.get('[DEMO] Downtown')!;
  const deliveryOrder = await prisma.order.findUniqueOrThrow({
    where: { id: `${organization.id}-order-delivery-preparing` },
  });
  // Backfill the fee into the order's own total — see schema.prisma's Phase
  // 6 comment for why deliveryFee lives on Order at all. Guarded on
  // deliveryFee still being unset so `prisma db seed` stays idempotent —
  // without this check, re-running the seed would add the fee again on
  // every run instead of upserting to a fixed value.
  const deliveryFeeAmount = Number(downtownZone.deliveryFee);
  if (Number(deliveryOrder.deliveryFee) === 0) {
    await prisma.order.update({
      where: { id: deliveryOrder.id },
      data: {
        deliveryFee: downtownZone.deliveryFee,
        total: (Number(deliveryOrder.total) + deliveryFeeAmount).toFixed(2),
      },
    });
  }

  const deliveryOrderRecord = await prisma.deliveryOrder.upsert({
    where: { orderId: deliveryOrder.id },
    update: {},
    create: {
      id: `${organization.id}-delivery-order-delivery-preparing`,
      organizationId: organization.id,
      branchId: branchA.id,
      orderId: deliveryOrder.id,
      deliveryZoneId: downtownZone.id,
      deliveryFee: downtownZone.deliveryFee,
      driverId: driver.id,
      status: 'ASSIGNED',
    },
  });
  const deliveryHistoryExists = await prisma.deliveryStatusHistory.findFirst({
    where: { deliveryOrderId: deliveryOrderRecord.id },
  });
  if (!deliveryHistoryExists) {
    await prisma.deliveryStatusHistory.create({
      data: { deliveryOrderId: deliveryOrderRecord.id, fromStatus: null, toStatus: 'UNASSIGNED' },
    });
    await prisma.deliveryStatusHistory.create({
      data: {
        deliveryOrderId: deliveryOrderRecord.id,
        fromStatus: 'UNASSIGNED',
        toStatus: 'ASSIGNED',
        changedByUserId: driverUser.id,
        note: '[DEMO] Dispatched to the on-shift driver.',
      },
    });
  }
  const assignmentId = `${organization.id}-driver-assignment-delivery-preparing`;
  await prisma.driverAssignment.upsert({
    where: { id: assignmentId },
    update: {},
    create: { id: assignmentId, deliveryOrderId: deliveryOrderRecord.id, driverId: driver.id },
  });
  console.log('  seeded 1 dispatched delivery order (ASSIGNED, fee included in order total)');

  // --- Phase 7: catering packages, inquiries at each funnel stage --------
  // Two packages, and three inquiries showing the funnel at NEW (no quote
  // yet), QUOTED (a SENT quote awaiting the customer's response), and
  // CONVERTED (an ACCEPTED quote that auto-created its event, with a
  // deposit already recorded) — the same "seed every status, not just the
  // happy path" convention every prior phase's seed data follows.
  const cateringPackageDefs = [
    { branchId: branchA.id, name: '[DEMO] Silver Package', pricePerGuest: '500.00' },
    { branchId: branchA.id, name: '[DEMO] Gold Package', pricePerGuest: '800.00' },
  ];
  const cateringPackageByName = new Map<string, { id: string; pricePerGuest: string }>();
  for (const def of cateringPackageDefs) {
    const pkg = await prisma.cateringPackage.upsert({
      where: { branchId_name: { branchId: def.branchId, name: def.name } },
      update: {},
      create: { organizationId: organization.id, branchId: def.branchId, name: def.name, pricePerGuest: def.pricePerGuest },
    });
    cateringPackageByName.set(def.name, { id: pkg.id, pricePerGuest: def.pricePerGuest });
  }
  console.log(`  seeded ${cateringPackageDefs.length} catering packages`);

  const silverPackage = cateringPackageByName.get('[DEMO] Silver Package')!;
  const goldPackage = cateringPackageByName.get('[DEMO] Gold Package')!;

  // Inquiry 1: NEW, no quote yet.
  const inquiryNewId = `${organization.id}-catering-inquiry-new`;
  await prisma.cateringInquiry.upsert({
    where: { id: inquiryNewId },
    update: {},
    create: {
      id: inquiryNewId,
      organizationId: organization.id,
      branchId: branchA.id,
      guestName: '[DEMO] Liza Santos',
      guestEmail: 'liza.santos@example.com',
      guestPhone: '+63 917 000 1111',
      eventType: 'Birthday Party',
      eventDate: new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000),
      location: '[DEMO] Client residence, Makati',
      guestCount: 50,
      status: 'NEW',
      specialRequests: '[DEMO] One vegetarian and one halal guest.',
    },
  });

  // Inquiry 2 + Quote (SENT): QUOTED, awaiting customer response.
  const inquiryQuotedId = `${organization.id}-catering-inquiry-quoted`;
  await prisma.cateringInquiry.upsert({
    where: { id: inquiryQuotedId },
    update: {},
    create: {
      id: inquiryQuotedId,
      organizationId: organization.id,
      branchId: branchA.id,
      guestName: '[DEMO] Marco Reyes',
      guestEmail: 'marco.reyes@example.com',
      guestPhone: '+63 917 000 2222',
      eventType: 'Corporate Event',
      eventDate: new Date(now.getTime() + 35 * 24 * 60 * 60 * 1000),
      location: '[DEMO] Ayala Tower Function Hall, Makati',
      guestCount: 30,
      packageId: silverPackage.id,
      status: 'QUOTED',
    },
  });
  // Quote totals, hand-computed against the master spec's formula (Food +
  // Staffing + Equipment + Transportation + Setup + Service Fees -
  // Discounts + Taxes = TOTAL), independently checkable:
  //   food 30 x 500.00 = 15000.00
  //   + staffing 2000.00 + equipment 500.00 + transportation 500.00
  //   + setup 500.00 + serviceFee 1000.00 - discount 0.00 = 19500.00
  //   + tax (12%) 2340.00 = 21840.00
  const quoteSentId = `${organization.id}-catering-quote-sent`;
  const quoteSent = await prisma.cateringQuote.upsert({
    where: { id: quoteSentId },
    update: {},
    create: {
      id: quoteSentId,
      organizationId: organization.id,
      branchId: branchA.id,
      inquiryId: inquiryQuotedId,
      packageId: silverPackage.id,
      guestCount: 30,
      foodTotal: '15000.00',
      staffingTotal: '2000.00',
      equipmentTotal: '500.00',
      transportationTotal: '500.00',
      setupTotal: '500.00',
      serviceFeeTotal: '1000.00',
      discountTotal: '0.00',
      taxTotal: '2340.00',
      total: '21840.00',
      status: 'SENT',
      sentAt: now,
    },
  });
  const quoteSentItemExists = await prisma.cateringQuoteItem.findFirst({ where: { quoteId: quoteSent.id } });
  if (!quoteSentItemExists) {
    await prisma.cateringQuoteItem.create({
      data: { quoteId: quoteSent.id, description: '[DEMO] Silver Package (per guest)', quantity: 30, unitPrice: '500.00', lineTotal: '15000.00' },
    });
  }

  // Inquiry 3 + Quote (ACCEPTED) + Event (SCHEDULED) + deposit payment:
  // CONVERTED, demonstrating the funnel's automatic accept-to-event step.
  const inquiryConvertedId = `${organization.id}-catering-inquiry-converted`;
  await prisma.cateringInquiry.upsert({
    where: { id: inquiryConvertedId },
    update: {},
    create: {
      id: inquiryConvertedId,
      organizationId: organization.id,
      branchId: branchA.id,
      guestName: '[DEMO] Patricia Cruz',
      guestEmail: 'patricia.cruz@example.com',
      guestPhone: '+63 917 000 3333',
      eventType: 'Wedding Reception',
      eventDate: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      location: '[DEMO] Grand Ballroom, Makati',
      guestCount: 100,
      packageId: goldPackage.id,
      status: 'CONVERTED',
    },
  });
  // Quote totals: food 100 x 800.00 = 80000.00 + staffing 5000.00
  // + equipment 2000.00 + transportation 1000.00 + setup 1000.00
  // + serviceFee 3000.00 - discount 2000.00 = 90000.00 + tax (12%)
  // 10800.00 = 100800.00.
  const quoteAcceptedId = `${organization.id}-catering-quote-accepted`;
  const quoteAccepted = await prisma.cateringQuote.upsert({
    where: { id: quoteAcceptedId },
    update: {},
    create: {
      id: quoteAcceptedId,
      organizationId: organization.id,
      branchId: branchA.id,
      inquiryId: inquiryConvertedId,
      packageId: goldPackage.id,
      guestCount: 100,
      foodTotal: '80000.00',
      staffingTotal: '5000.00',
      equipmentTotal: '2000.00',
      transportationTotal: '1000.00',
      setupTotal: '1000.00',
      serviceFeeTotal: '3000.00',
      discountTotal: '2000.00',
      taxTotal: '10800.00',
      total: '100800.00',
      status: 'ACCEPTED',
      sentAt: now,
      respondedAt: now,
    },
  });
  const quoteAcceptedItemExists = await prisma.cateringQuoteItem.findFirst({ where: { quoteId: quoteAccepted.id } });
  if (!quoteAcceptedItemExists) {
    await prisma.cateringQuoteItem.create({
      data: { quoteId: quoteAccepted.id, description: '[DEMO] Gold Package (per guest)', quantity: 100, unitPrice: '800.00', lineTotal: '80000.00' },
    });
  }

  const cateringEventId = `${organization.id}-catering-event-scheduled`;
  const cateringEvent = await prisma.cateringEvent.upsert({
    where: { quoteId: quoteAccepted.id },
    update: {},
    create: {
      id: cateringEventId,
      organizationId: organization.id,
      branchId: branchA.id,
      quoteId: quoteAccepted.id,
      guestName: '[DEMO] Patricia Cruz',
      guestEmail: 'patricia.cruz@example.com',
      guestPhone: '+63 917 000 3333',
      eventType: 'Wedding Reception',
      eventDate: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      location: '[DEMO] Grand Ballroom, Makati',
      guestCount: 100,
      status: 'SCHEDULED',
      total: '100800.00',
      depositAmount: '30000.00',
    },
  });
  const cateringEventItemExists = await prisma.cateringEventItem.findFirst({ where: { eventId: cateringEvent.id } });
  if (!cateringEventItemExists) {
    await prisma.cateringEventItem.create({
      data: { eventId: cateringEvent.id, description: '[DEMO] Gold Package (per guest)', quantity: 100, unitPrice: '800.00', lineTotal: '80000.00' },
    });
  }
  const depositPaymentId = `${organization.id}-catering-payment-deposit`;
  await prisma.cateringPayment.upsert({
    where: { id: depositPaymentId },
    update: {},
    create: {
      id: depositPaymentId,
      organizationId: organization.id,
      branchId: branchA.id,
      eventId: cateringEvent.id,
      type: 'DEPOSIT',
      method: 'BANK_TRANSFER',
      amount: '30000.00',
      status: 'COMPLETED',
      note: '[DEMO] 30% deposit received on quote acceptance.',
    },
  });
  console.log('  seeded 3 catering inquiries (NEW, QUOTED, CONVERTED-with-scheduled-event-and-deposit)');

  // --- Phase 8: CRM — customer profiles across the funnel -----------------
  // Three customers, each demonstrating a different point from the
  // "Phase 8 — CRM" schema.prisma comment block: a repeat guest WITH a
  // registered User account and real linked order history (design
  // decision #1's minority case); a guest-only lead with a profile but no
  // transactions yet; and a retroactive link onto Phase 7's already-seeded
  // CONVERTED catering funnel, showing customerId is attached explicitly
  // rather than auto-matched even for pre-existing history (decision #2).
  const customerUser = await prisma.user.findFirstOrThrow({
    where: { organizationId: organization.id, email: 'customer@restaurant-platform.local' },
  });
  const managerUser = await prisma.user.findFirstOrThrow({
    where: { organizationId: organization.id, email: 'manager@restaurant-platform.local' },
  });

  const customerGraceId = `${organization.id}-customer-grace`;
  const customerGrace = await prisma.customer.upsert({
    where: { id: customerGraceId },
    update: {},
    create: {
      id: customerGraceId,
      organizationId: organization.id,
      userId: customerUser.id,
      firstName: '[DEMO]',
      lastName: 'Villanueva',
      email: customerUser.email,
      phone: '+63 917 500 1000',
      status: 'ACTIVE',
    },
  });

  // Two completed take-out orders, backdated so recency/frequency are
  // independently checkable: 60 and 10 days ago.
  const haloHalo = itemByName.get('Halo-Halo')!;
  const iceTea = itemByName.get('Iced Tea')!;
  const graceOrderDefs = [
    {
      id: `${organization.id}-order-crm-grace-1`,
      daysAgo: 60,
      items: [
        { item: chickenInasal, quantity: 2, unitPrice: '195.00' },
        { item: iceTea, quantity: 1, unitPrice: '60.00' },
      ],
      // 2x195.00 + 60.00 = 450.00 + 12% tax (54.00) = 504.00
      subtotal: '450.00',
      taxTotal: '54.00',
      total: '504.00',
    },
    {
      id: `${organization.id}-order-crm-grace-2`,
      daysAgo: 10,
      items: [
        { item: chickenInasal, quantity: 1, unitPrice: '195.00' },
        { item: haloHalo, quantity: 1, unitPrice: '135.00' },
      ],
      // 195.00 + 135.00 = 330.00 + 12% tax (39.60) = 369.60
      subtotal: '330.00',
      taxTotal: '39.60',
      total: '369.60',
    },
  ];
  for (const def of graceOrderDefs) {
    const order = await prisma.order.upsert({
      where: { id: def.id },
      update: {},
      create: {
        id: def.id,
        organizationId: organization.id,
        branchId: branchA.id,
        type: 'TAKEOUT',
        status: 'COMPLETED',
        customerId: customerGrace.id,
        guestName: '[DEMO] Grace Villanueva',
        subtotal: def.subtotal,
        taxTotal: def.taxTotal,
        total: def.total,
        createdAt: new Date(now.getTime() - def.daysAgo * 24 * 60 * 60 * 1000),
      },
    });
    const itemsExist = await prisma.orderItem.findFirst({ where: { orderId: order.id } });
    if (!itemsExist) {
      for (const line of def.items) {
        const lineTotal = (Number(line.unitPrice) * line.quantity).toFixed(2);
        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            menuItemId: line.item.id,
            nameSnapshot: line.item.name,
            unitPriceSnapshot: line.unitPrice,
            quantity: line.quantity,
            lineSubtotal: lineTotal,
            lineTotal,
          },
        });
      }
    }
  }
  console.log('  seeded 2 CRM-linked orders for [DEMO] Grace Villanueva (₱504.00, ₱369.60 — RETURNING segment)');

  await prisma.customerAddress.upsert({
    where: { id: `${organization.id}-customer-grace-address` },
    update: {},
    create: {
      id: `${organization.id}-customer-grace-address`,
      customerId: customerGrace.id,
      label: 'Home',
      line1: '456 Kalayaan Ave',
      city: 'Makati City',
      isDefault: true,
    },
  });
  await prisma.customerPreference.upsert({
    where: { customerId_key: { customerId: customerGrace.id, key: 'dietary' } },
    update: {},
    create: { customerId: customerGrace.id, key: 'dietary', value: 'No seafood' },
  });
  const graceTagExists = await prisma.customerTag.findFirst({ where: { customerId: customerGrace.id, tag: 'regular' } });
  if (!graceTagExists) {
    await prisma.customerTag.create({ data: { customerId: customerGrace.id, tag: 'regular', createdByUserId: managerUser.id } });
  }
  const graceNoteExists = await prisma.customerNote.findFirst({ where: { customerId: customerGrace.id } });
  if (!graceNoteExists) {
    await prisma.customerNote.create({
      data: {
        customerId: customerGrace.id,
        authorUserId: managerUser.id,
        note: '[DEMO] Always asks for extra rice on the side — a regular, comp it occasionally.',
      },
    });
  }
  const graceSecondOrderId = graceOrderDefs[1]!.id;
  const graceReviewExists = await prisma.customerReview.findFirst({
    where: { customerId: customerGrace.id, orderId: graceSecondOrderId },
  });
  if (!graceReviewExists) {
    await prisma.customerReview.create({
      data: {
        organizationId: organization.id,
        branchId: branchA.id,
        customerId: customerGrace.id,
        orderId: graceSecondOrderId,
        rating: 5,
        comment: '[DEMO] Food was hot and fast, as always!',
        recordedByUserId: managerUser.id,
      },
    });
  }
  console.log('  seeded 1 address / 1 preference / 1 tag / 1 note / 1 review for [DEMO] Grace Villanueva');

  // Customer 2: a guest-only lead — a profile exists (staff took her
  // number when she called to ask about the menu) but she has no
  // transactions yet, so she reads as NEW with zero of everything. Proves
  // a Customer profile is meaningful on its own, independent of any order/
  // reservation/catering row — the whole point of decision #1.
  const customerMarcoId = `${organization.id}-customer-marco`;
  await prisma.customer.upsert({
    where: { id: customerMarcoId },
    update: {},
    create: {
      id: customerMarcoId,
      organizationId: organization.id,
      firstName: '[DEMO]',
      lastName: 'dela Peña',
      phone: '+63 917 500 2000',
      status: 'ACTIVE',
    },
  });
  console.log('  seeded 1 guest-only (no transactions yet) customer profile for [DEMO] Marco dela Peña (NEW segment)');

  // Customer 3: retroactively linked onto Phase 7's already-seeded
  // CONVERTED catering funnel (inquiry -> quote -> event) above. A single
  // ₱100,800.00 catering event is enough to classify as HIGH_VALUE even
  // though it's her only transaction ever — see lib/crm/rfm.ts's
  // classifySegment precedence comment for why HIGH_VALUE is checked
  // before NEW. Plain field assignment, safe to run unconditionally on
  // every seed run (idempotent by nature, unlike the deliveryFee backfill
  // in the Phase 6 block above, which needed a guard because it increments
  // a total instead of just setting a value).
  const customerPatriciaId = `${organization.id}-customer-patricia`;
  const customerPatricia = await prisma.customer.upsert({
    where: { id: customerPatriciaId },
    update: {},
    create: {
      id: customerPatriciaId,
      organizationId: organization.id,
      firstName: '[DEMO]',
      lastName: 'Cruz',
      email: 'patricia.cruz@example.com',
      phone: '+63 917 000 3333',
      status: 'ACTIVE',
    },
  });
  await prisma.cateringInquiry.update({
    where: { id: inquiryConvertedId },
    data: { customerId: customerPatricia.id },
  });
  await prisma.cateringEvent.update({
    where: { id: cateringEvent.id },
    data: { customerId: customerPatricia.id },
  });
  console.log(
    "  linked [DEMO] Patricia Cruz's existing catering funnel to her new customer profile (HIGH_VALUE via a single ₱100,800.00 event)",
  );

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
