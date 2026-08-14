-- Phase 2 migration: table sections/tables/status history, and the menu
-- (categories, items, variants, modifier groups/modifiers). Hand-authored to
-- match prisma/schema.prisma for the same reason as the Phase 1 migration —
-- no network access to run `prisma migrate dev` in this build environment.

-- Enums
CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'OCCUPIED', 'WAITING', 'CLEANING', 'OUT_OF_SERVICE');
CREATE TYPE "ModifierSelectionType" AS ENUM ('SINGLE', 'MULTIPLE');

-- table_sections
CREATE TABLE "table_sections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "table_sections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "table_sections_branchId_name_key" ON "table_sections"("branchId", "name");
CREATE INDEX "table_sections_organizationId_idx" ON "table_sections"("organizationId");
CREATE INDEX "table_sections_branchId_idx" ON "table_sections"("branchId");

-- restaurant_tables
CREATE TABLE "restaurant_tables" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sectionId" TEXT,
    "tableNumber" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "restaurant_tables_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "restaurant_tables_branchId_tableNumber_key" ON "restaurant_tables"("branchId", "tableNumber");
CREATE INDEX "restaurant_tables_organizationId_idx" ON "restaurant_tables"("organizationId");
CREATE INDEX "restaurant_tables_branchId_idx" ON "restaurant_tables"("branchId");

-- table_status_history
CREATE TABLE "table_status_history" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "fromStatus" "TableStatus",
    "toStatus" "TableStatus" NOT NULL,
    "changedByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "table_status_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "table_status_history_tableId_createdAt_idx" ON "table_status_history"("tableId", "createdAt");

-- menu_categories
CREATE TABLE "menu_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "menu_categories_organizationId_name_key" ON "menu_categories"("organizationId", "name");
CREATE INDEX "menu_categories_organizationId_idx" ON "menu_categories"("organizationId");

-- menu_modifier_groups
CREATE TABLE "menu_modifier_groups" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "selectionType" "ModifierSelectionType" NOT NULL DEFAULT 'SINGLE',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "menu_modifier_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "menu_modifier_groups_organizationId_name_key" ON "menu_modifier_groups"("organizationId", "name");
CREATE INDEX "menu_modifier_groups_organizationId_idx" ON "menu_modifier_groups"("organizationId");

-- menu_modifiers
CREATE TABLE "menu_modifiers" (
    "id" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "menu_modifiers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "menu_modifiers_modifierGroupId_name_key" ON "menu_modifiers"("modifierGroupId", "name");
CREATE INDEX "menu_modifiers_modifierGroupId_idx" ON "menu_modifiers"("modifierGroupId");

-- menu_items
CREATE TABLE "menu_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "cost" DECIMAL(10,2),
    "preparationTimeMinutes" INTEGER,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "taxCategory" TEXT NOT NULL DEFAULT 'STANDARD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "menu_items_organizationId_idx" ON "menu_items"("organizationId");
CREATE INDEX "menu_items_categoryId_idx" ON "menu_items"("categoryId");

-- menu_item_variants
CREATE TABLE "menu_item_variants" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "cost" DECIMAL(10,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "menu_item_variants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "menu_item_variants_menuItemId_name_key" ON "menu_item_variants"("menuItemId", "name");
CREATE INDEX "menu_item_variants_menuItemId_idx" ON "menu_item_variants"("menuItemId");

-- menu_item_modifier_groups
CREATE TABLE "menu_item_modifier_groups" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "menu_item_modifier_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "menu_item_modifier_groups_menuItemId_modifierGroupId_key" ON "menu_item_modifier_groups"("menuItemId", "modifierGroupId");
CREATE INDEX "menu_item_modifier_groups_menuItemId_idx" ON "menu_item_modifier_groups"("menuItemId");

-- Foreign keys
ALTER TABLE "table_sections" ADD CONSTRAINT "table_sections_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "table_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "table_status_history" ADD CONSTRAINT "table_status_history_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "restaurant_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_modifier_groups" ADD CONSTRAINT "menu_modifier_groups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_modifiers" ADD CONSTRAINT "menu_modifiers_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "menu_modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "menu_item_variants" ADD CONSTRAINT "menu_item_variants_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "menu_modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
