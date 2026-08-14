# Database

PostgreSQL, managed via Prisma (`prisma/schema.prisma`). See that file for the authoritative
schema; this document explains the conventions and the current (Phase 1 + 2) scope.

## Conventions

- IDs: `cuid()`, field name `id`.
- Every tenant-scoped model has `organizationId String` with a `@relation` to `Organization` and
  a `@@index([organizationId])`.
- Timestamps: `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`.
- Soft delete: `deletedAt DateTime?` on models that participate in financial/audit history
  (e.g. `User`). Hard delete is reserved for models with no downstream referential/financial
  impact.
- Money: `Decimal` with explicit precision/scale (`@db.Decimal(10, 2)`), never `Float`. First used
  in Phase 2 (`MenuItem.price/cost`, `MenuItemVariant.price/cost`, `MenuModifier.priceDelta`) —
  verified against a real Postgres instance to store exactly, no floating-point drift (see
  `CLAUDE.md` → Known Issues).
- Enums: Prisma `enum` for closed status sets (`UserStatus`, `BranchStatus`, `TableStatus`,
  `ModifierSelectionType`, later `OrderStatus`, `PaymentStatus`, etc.).
- Unique constraints: e.g. `@@unique([organizationId, email])` on `User` — email is unique per
  organization, not globally, since the same person could be a customer of two different
  restaurant organizations on the platform.

## Phase 1 Schema

### Organization
The top-level tenant. Fields: `id, name, legalName, email, phone, currency, timezone, createdAt,
updatedAt`. Default seed uses `currency = "PHP"`, `timezone = "Asia/Manila"` — both are per-org
configuration, not hard-coded globally.

### Branch
Belongs to an `Organization`. Fields: `id, organizationId, name, address, phone, email, timezone,
openingHours (Json), status, createdAt, updatedAt`.

### User
Belongs to an `Organization`. Fields: `id, organizationId, email, passwordHash, firstName,
lastName, phone, status, createdAt, updatedAt, deletedAt`. Password is always bcrypt-hashed;
`passwordHash` is never selected into API responses (enforced via a dedicated Prisma `select`
in `AuthService`, never `select: { ... all ... }`).

### Role / Permission / RolePermission / UserRole
Granular RBAC:
- `Role`: `id, organizationId, name, description` — organization-scoped so an org can eventually
  define custom roles, but seed data creates the seven spec-mandated roles per organization:
  `CUSTOMER, STAFF, MANAGER, ACCOUNTANT, DRIVER, OWNER, ADMINISTRATOR`.
- `Permission`: `id, key, description` — global catalog (e.g. `org:manage`, `branch:manage`,
  `user:manage`, `reservation:manage`, ...). Not org-scoped; the catalog of *possible* permissions
  is platform-wide, which roles grant them is per-org.
- `RolePermission`: join table `roleId, permissionId`.
- `UserRole`: join table `userId, roleId` — a user can hold more than one role (e.g. an
  owner who also works as a manager at one branch).

### AuditLog
Fields: `id, organizationId, branchId?, userId?, action, entityType, entityId, previousValue
(Json?), newValue (Json?), ipAddress?, createdAt`. Written by services for security- and
finance-relevant actions. Append-only — no update/delete API exists for audit logs.

## Phase 2 Schema

### TableSection / RestaurantTable / TableStatusHistory
Branch-scoped. `TableSection`: `id, organizationId, branchId, name, description?, active` — name
unique per branch. `RestaurantTable`: `id, organizationId, branchId, sectionId?, tableNumber,
capacity, status (TableStatus), active` — table number unique per branch (not globally; two
branches can each have a "Table 1"). Deleting a section sets `sectionId` to `null` on its tables
(`onDelete: SetNull`) rather than deleting the tables. `TableStatusHistory`: `id, tableId,
fromStatus? (TableStatus), toStatus (TableStatus), changedByUserId?, note?, createdAt` — append
only, one row per status change including the table's initial status (`fromStatus = null`).
Deleting a table cascades to its history (`onDelete: Cascade`) since the history is meaningless
without the table.

`TableStatus` enum: `AVAILABLE, RESERVED, OCCUPIED, WAITING, CLEANING, OUT_OF_SERVICE` — exactly
the spec's list. The database does not enforce *which* transitions are legal (Postgres enums
don't support that); `TableService.ALLOWED_TRANSITIONS` does, server-side, before any status
write happens.

### MenuCategory / MenuItem / MenuItemVariant / MenuModifierGroup / MenuModifier / MenuItemModifierGroup
Organization-scoped (not branch-scoped — see `docs/architecture.md` § 10 for why). `MenuCategory`:
`id, organizationId, name, description?, displayOrder, active` — name unique per org. `MenuItem`:
`id, organizationId, categoryId, name, description?, price (Decimal), cost? (Decimal),
preparationTimeMinutes?, available, imageUrl?, taxCategory (string, default "STANDARD"), active`.
`categoryId` is `onDelete: Restrict` — a category with items cannot be deleted until its items are
reassigned or removed, verified with a smoke test. `MenuItemVariant`: `id, menuItemId, name, price
(Decimal), cost? (Decimal), active, displayOrder` — name unique per item, cascades on item delete.

`MenuModifierGroup` and the `ModifierSelectionType` enum (`SINGLE` / `MULTIPLE`) are **not** in
the master spec's literal table list (which only names `menu_modifiers` and
`menu_item_modifiers`) — added because a flat, ungrouped modifier list can't express "choose
exactly one Size" vs. "choose any number of Add-ons," a distinction the order-taking flow (Phase
4) needs. `MenuModifierGroup`: `id, organizationId, name, selectionType, required, minSelect,
maxSelect` — name unique per org. `MenuModifier`: `id, modifierGroupId, name, priceDelta
(Decimal, default 0), active, displayOrder` — name unique per group, cascades on group delete.
`MenuItemModifierGroup` is the join table (`menuItemId, modifierGroupId`, unique pair) linking
which modifier groups apply to which item — this is the literal `menu_item_modifiers` table from
the spec, renamed for clarity since it links to groups, not individual modifiers directly.

## Phase 3 Schema

### Reservation / ReservationTable / ReservationStatusHistory
Branch-scoped. `Reservation`: `id, organizationId, branchId, customerUserId?, guestName,
guestEmail?, guestPhone?, startAt, endAt, guestCount, status (ReservationStatus), specialRequests?,
occasion?, depositRequired, depositAmount? (Decimal), depositStatus
(ReservationDepositStatus), depositNote?, cancellationReason?, cancelledAt?`. No separate
`reservation_guests` table (guest contact is a snapshot directly on the reservation — full CRM
guest profiles are Phase 8) and no separate `reservation_payments` table (deposits are recorded
manually by staff, embedded as fields — a real payments ledger arrives with Phase 4/10). See the
"Phase 3 — Reservations" comment block at the top of that section in `schema.prisma` for the full
reasoning on both deviations.

`ReservationTable` is the join table to `RestaurantTable`, supporting multi-table assignment for
large parties. It **denormalizes** `startAt`, `endAt`, and `status` from the parent reservation —
required so a Postgres `EXCLUDE` constraint can be declared directly on this table. `startAt`,
`endAt`, `status` are kept in sync with the parent `Reservation` by `ReservationService` inside the
same transaction; they are never written independently by any other code path.

`ReservationStatusHistory` mirrors `TableStatusHistory`'s pattern exactly: append-only, one row per
status change including the initial creation (`fromStatus = null`).

`ReservationStatus` enum: `PENDING, CONFIRMED, SEATED, COMPLETED, CANCELLED, NO_SHOW`.
`ReservationDepositStatus` enum: `NONE, PENDING, PAID, REFUNDED`. As with `TableStatus`, Postgres
enums don't encode *which* transitions are legal — `ReservationService`'s status-transition
whitelist does, server-side, before any status write happens.

### Double-booking prevention (DB-enforced)
`reservation_tables` carries a hand-written (not Prisma-DSL-expressible) constraint:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE reservation_tables ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist ("tableId" WITH =, tsrange("startAt", "endAt") WITH &&)
  WHERE (status NOT IN ('CANCELLED', 'NO_SHOW'));
```

This rejects any two active bookings of the same table with overlapping `[startAt, endAt)` ranges
— at the database level, so it holds even under a race condition or an application bug, not just
when `ReservationService`'s own (also present, but not solely relied upon) availability check
passes. Verified with a genuine two-process concurrent `psql` test, not just sequential assertions
— see `CLAUDE.md` → Known Issues for the full transcript description. Because this constraint has
no representation in `schema.prisma`, `prisma db pull` would not perfectly round-trip
`reservation_tables` — noted here so that's understood as a deliberate, documented gap, not drift.

## Phase 4 Schema

### Order / OrderItem / OrderItemModifier / OrderStatusHistory
Branch-scoped. `Order`: `id, organizationId, branchId, type (OrderType), status (OrderStatus),
customerUserId?, guestName?, guestEmail?, guestPhone?, tableId?, reservationId?,
deliveryAddress?, subtotal, taxTotal, discountTotal, total (all Decimal), notes?,
cancellationReason?, cancelledAt?`. Like `Reservation`, there is no separate `customers` table —
a registered customer is linked via `customerUserId`, a walk-in/phone/delivery order captures a
guest-contact snapshot directly on the row. `tableId` is required in practice for `DINE_IN`
orders and optional otherwise (enforced in `OrderService`/Zod, not a DB constraint, since the
legal combinations depend on `type`); `reservationId` optionally links a dine-in order back to the
reservation that seated it.

`OrderType` enum: `DINE_IN, TAKEOUT, DELIVERY`. `OrderStatus` enum: `PENDING, CONFIRMED,
PREPARING, READY, COMPLETED, CANCELLED` — legal transitions are whitelisted in
`OrderService.ALLOWED_TRANSITIONS`, the same pattern as `TableStatus`/`ReservationStatus`.

`OrderItem`: `id, orderId, menuItemId (FK, ON DELETE RESTRICT), menuItemVariantId? (FK, ON DELETE
RESTRICT), nameSnapshot, unitPriceSnapshot, quantity, lineSubtotal, modifiersTotal, lineTotal,
notes?`. `OrderItemModifier`: `id, orderItemId, modifierId (FK, ON DELETE RESTRICT),
nameSnapshot, priceDeltaSnapshot`. Both FKs to the menu are `RESTRICT`, not `CASCADE` or
`SET NULL` — a menu item/variant/modifier that has ever been ordered cannot be deleted (the menu
UI should soft-delete via `available: false` / `deletedAt` instead); this is what actually makes
the `nameSnapshot`/`*PriceSnapshot` fields meaningful as permanent order history rather than just
a cache. `OrderStatusHistory` mirrors `TableStatusHistory`/`ReservationStatusHistory`: append-only,
one row per status change including creation (`fromStatus = null`).

### OrderPayment
`id, orderId, method (OrderPaymentMethod), amount (Decimal), status (OrderPaymentStatus), note?,
recordedByUserId?`. `OrderPaymentMethod` enum: `CASH, CARD, GCASH, MAYA, BANK_TRANSFER, OTHER`.
`OrderPaymentStatus` enum: `PENDING, COMPLETED, REFUNDED`. No payment-gateway fields
(`providerTransactionId`, etc.) — every row here is a staff attestation that money changed hands
by some external means, the same "no separate `reservation_payments` table, deposit is staff
-recorded" decision Phase 3 made for `Reservation.depositStatus`. `OrderService.paymentSummary`
computes `paidAmount = Σ(amount WHERE status=COMPLETED) − Σ(amount WHERE status=REFUNDED)`,
`balanceDue = order.total − paidAmount`, `isFullyPaid = balanceDue <= 0`, entirely in application
code — there's no generated/materialized column for it.

### Invoice / InvoiceItem / InvoiceSequence
`Invoice`: `id, organizationId, branchId, orderId (FK, ON DELETE RESTRICT), invoiceNumber, status
(InvoiceStatus), subtotal, taxTotal, discountTotal, total (Decimal snapshots of the order at
issuance time), issuedAt, voidedAt?, voidReason?`. `@@unique([branchId, invoiceNumber])` — invoice
numbers are unique per branch, not globally (each branch has its own sequence, matching how a
real restaurant's official receipt books work). The order FK is `RESTRICT`, not `CASCADE`: an
order that has ever been invoiced cannot be deleted out from under its invoice.

`InvoiceItem`: `id, invoiceId, nameSnapshot, unitPriceSnapshot, quantity, lineTotal,
modifiersSummary?`. Deliberately **not** a nested modifier table — `modifiersSummary` is a
flattened, human-readable string (e.g. `"Cheese, No Onion"`) built at issuance time from the
order's own `OrderItemModifier` rows. A real invoice line item exists to be printed/emailed
exactly as issued; re-normalizing it into a queryable modifier structure would just be
`OrderItemModifier` duplicated for no benefit, since the source of truth for "what was ordered"
is always the `Order`/`OrderItem` tree, not the invoice.

`InvoiceStatus` enum: `ISSUED, VOID`. There is no `PAID`/`SENT`/`OVERDUE` status — an invoice can
only be issued once an order is already fully paid (checked in `InvoiceService.issueInvoice` via
`OrderService.paymentSummary`), so an invoice in this system is a paid-order receipt, not an
accounts-receivable document; that distinction will matter once Phase 10's accounting ledger and
any future "invoice now, pay later" flow exist.

`InvoiceSequence`: `id, branchId (@unique), lastNumber (default 0)`. One row per branch, advanced
atomically (`upsert` + `increment`) inside the same transaction as the `Invoice` insert it's
generating a number for — see § "Sequential invoice numbering" below.

### One active invoice per order (DB-enforced) and sequential numbering
`invoices` carries a hand-written (not Prisma-DSL-expressible) partial unique index:

```sql
CREATE UNIQUE INDEX "invoices_one_active_per_order" ON "invoices" ("orderId")
  WHERE (status != 'VOID');
```

This allows an order to have at most one non-`VOID` invoice at a time, while still permitting a
void-then-reissue history (each reissue gets a new row and a new number; the old one stays around
as a permanent `VOID` record). As with Phase 3's `EXCLUDE` constraint, `prisma db pull` would not
perfectly round-trip this index — documented here, in `schema.prisma`'s Phase 4 comment block, and
in `InvoiceService.translateDbError` as a deliberate, known gap.

Sequential numbering (`INV-000001`, `INV-000002`, ...) is **not** `orderId`-derived or
timestamp-derived — it comes from `InvoiceSequence.lastNumber`, advanced via an atomic
`upsert(... update: { lastNumber: { increment: 1 } })` inside the same transaction that inserts
the `Invoice` row, relying on Postgres's own row-level locking on the `UPDATE` path (a different
mechanism from the `EXCLUDE` constraint above, because "assign the next number, no gaps, no
duplicates" is a different guarantee than "reject an overlapping range"). Verified under genuine
concurrent load — see `CLAUDE.md` → Known Issues.

## Forward-Looking Schema (not created yet)

The following table groups are specified in the master build prompt and will be added in their
respective phases, each with its own migration and tests:

- Phase 6: `delivery_zones`, `delivery_orders`, `drivers`, `driver_assignments`,
  `delivery_status_history`
- Phase 7: `catering_inquiries`, `catering_packages`, `catering_quotes`, `catering_quote_items`,
  `catering_events`, `catering_event_items`, `catering_payments`
- Phase 8: `customers`, `customer_addresses`, `customer_preferences`, `customer_notes`,
  `customer_tags`
- Phase 9: `ingredients`, `units`, `recipes`, `recipe_items`, `inventory_items`,
  `inventory_transactions`, `stock_counts`, `waste_records`, `suppliers`, `purchase_orders`,
  `purchase_order_items`
- Phase 10: `chart_of_accounts`, `accounting_periods`, `journal_entries`, `journal_entry_lines`,
  `financial_transactions`, `payments`, `payment_transactions`, `refunds`, `payment_webhooks`,
  `expenses`, `expense_categories`, `vendors`, `expense_attachments`

Introducing all of these now, before the services that use them exist, would violate the "do not
build in one uncontrolled pass" rule and leave untested tables in the schema — they're documented
here so the full data model is visible, but created migration-by-migration as each phase lands.

## Migrations

Run `npx prisma migrate dev --name <description>` for every schema change. Never edit a generated
migration file after it has been applied to a shared database — write a new migration instead.
`npx prisma migrate deploy` is used in production (see `docs/deployment.md`, added in Phase 16).
