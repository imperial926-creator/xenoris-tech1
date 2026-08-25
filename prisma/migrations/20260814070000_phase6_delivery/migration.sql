-- Phase 6 migration: delivery zones, driver profiles, delivery orders
-- (1:1 companion to orders), driver-assignment audit trail, and delivery
-- status history. Hand-authored to match prisma/schema.prisma for the same
-- reason as every prior migration in this repo -- no network access to run
-- `prisma migrate dev` here.
--
-- Also adds "deliveryFee" to the existing "orders" table so delivery fees
-- flow into Order.total (payments/invoices) -- see the "Phase 6 —
-- Delivery" comment block in schema.prisma for the full reasoning.

-- orders: new column
ALTER TABLE "orders" ADD COLUMN "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Enum
CREATE TYPE "DeliveryStatus" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'FAILED', 'CANCELLED');

-- delivery_zones
CREATE TABLE "delivery_zones" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "delivery_zones_branchId_name_key" ON "delivery_zones"("branchId", "name");
CREATE INDEX "delivery_zones_organizationId_idx" ON "delivery_zones"("organizationId");

-- drivers
CREATE TABLE "drivers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleType" TEXT,
    "vehiclePlate" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "drivers_userId_key" ON "drivers"("userId");
CREATE INDEX "drivers_organizationId_idx" ON "drivers"("organizationId");
CREATE INDEX "drivers_branchId_idx" ON "drivers"("branchId");

-- delivery_orders
CREATE TABLE "delivery_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "deliveryZoneId" TEXT,
    "driverId" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "estimatedDeliveryAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "proofOfDeliveryNote" TEXT,
    "recipientName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delivery_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "delivery_orders_orderId_key" ON "delivery_orders"("orderId");
CREATE INDEX "delivery_orders_organizationId_idx" ON "delivery_orders"("organizationId");
CREATE INDEX "delivery_orders_branchId_status_idx" ON "delivery_orders"("branchId", "status");
CREATE INDEX "delivery_orders_driverId_idx" ON "delivery_orders"("driverId");

-- delivery_status_history
CREATE TABLE "delivery_status_history" (
    "id" TEXT NOT NULL,
    "deliveryOrderId" TEXT NOT NULL,
    "fromStatus" "DeliveryStatus",
    "toStatus" "DeliveryStatus" NOT NULL,
    "changedByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "delivery_status_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "delivery_status_history_deliveryOrderId_idx" ON "delivery_status_history"("deliveryOrderId");

-- driver_assignments
CREATE TABLE "driver_assignments" (
    "id" TEXT NOT NULL,
    "deliveryOrderId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "note" TEXT,
    CONSTRAINT "driver_assignments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "driver_assignments_deliveryOrderId_idx" ON "driver_assignments"("deliveryOrderId");
CREATE INDEX "driver_assignments_driverId_idx" ON "driver_assignments"("driverId");

-- Foreign keys
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drivers" ADD CONSTRAINT "drivers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_deliveryZoneId_fkey" FOREIGN KEY ("deliveryZoneId") REFERENCES "delivery_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delivery_status_history" ADD CONSTRAINT "delivery_status_history_deliveryOrderId_fkey" FOREIGN KEY ("deliveryOrderId") REFERENCES "delivery_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_deliveryOrderId_fkey" FOREIGN KEY ("deliveryOrderId") REFERENCES "delivery_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
