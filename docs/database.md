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

## Phase 5 Schema

### Order.requiredAt (the only change)
The master spec's Kitchen Display section lists no new tables — the kitchen dashboard is a view
over the `Order`/`OrderItem` tree Phase 4 already built, not a parallel data model (see
`docs/architecture.md` § 13 for the full reasoning). The single schema change is one nullable
column: `Order.requiredAt DateTime?`, added via
`prisma/migrations/20260814060000_phase5_kitchen_display/migration.sql`
(`ALTER TABLE "orders" ADD COLUMN "requiredAt" TIMESTAMP(3);`). `NULL` means "as soon as
possible" (the default for most walk-in orders); when set, it drives the kitchen board's overdue
indicator only — it does not gate order creation or auto-cancel anything.

Every other field the kitchen board displays already existed before this phase: order number is
`Order.id`, items/quantities/modifiers come from `OrderItem`/`OrderItemModifier`, special
instructions are `Order.notes` (order-level) and `OrderItem.notes` (per-line), table and order
type are `Order.tableId`/`Order.table`/`Order.type`, and current status is `Order.status`. The
kitchen "queue" itself is not a stored view or materialized table — it is
`KitchenService.getQueue`'s query (`status IN ('PENDING','CONFIRMED','PREPARING','READY')`,
ordered by `createdAt` ascending), computed fresh on every request.

## Phase 6 Schema

### Order.deliveryFee (the one change to an existing table)
`Order` gains one column: `deliveryFee Decimal @default(0) @db.Decimal(10, 2)`. This is
deliberately **not** the only place a delivery's fee is stored (`DeliveryOrder.deliveryFee` below
is a second copy) — it exists so `Order.total` (and every payment/invoice calculation that reads
it) is correct without joining to `DeliveryOrder`. Both copies are written from the same snapshot,
in the same transaction, at order-creation time — one value, captured twice, not two sources of
truth. See `docs/architecture.md` § 14 for the full reasoning.

### DeliveryZone
`id, organizationId, branchId, name, description?, deliveryFee (Decimal), active (default true)`.
`@@unique([branchId, name])` — zone names are unique per branch, not globally, mirroring
`TableSection`'s `@@unique([branchId, name])`. A plain staff-defined named area with a flat fee;
no geofencing or address-derived boundaries (no maps API configured).

### Driver
`id, organizationId, branchId, userId (@unique, FK to User, ON DELETE CASCADE), vehicleType?,
vehiclePlate?, phone?, active (default true)`. Separate from the `DRIVER` role — a user can hold
the role without yet having a profile. `userId` is unique: at most one `Driver` profile per user,
enforced at the DB level, not just in `DriverService.create`'s pre-check (which exists for a
friendlier error message; the constraint is the actual guarantee under a race).

### DeliveryOrder
`id, organizationId, branchId, orderId (@unique, FK to Order, ON DELETE CASCADE), deliveryZoneId?
(FK to DeliveryZone, ON DELETE RESTRICT), driverId? (FK to Driver, ON DELETE SET NULL), status
(DeliveryStatus), deliveryFee (Decimal), estimatedDeliveryAt?, pickedUpAt?, deliveredAt?,
proofOfDeliveryNote?, recipientName?`. The `@unique orderId` makes this a true 1:1 companion table
to `Order`, per master spec §18's explicit `delivery_orders` table — not fields merged onto
`Order` directly, which would leave dine-in/take-out rows with permanently-null delivery columns.
Created inside the same transaction as its parent `Order` whenever `type === 'DELIVERY'`
(`OrderService.createOrder`), so the two rows can never exist independently. The zone FK is
`RESTRICT` (a zone that has ever been used by a delivery cannot be deleted — deactivate it
instead, same "soft-delete over hard-delete" pattern as the menu); the driver FK is `SET NULL`
(unassigning a driver, or removing their profile, should not destroy delivery history).

`DeliveryStatus` enum: `UNASSIGNED, ASSIGNED, PICKED_UP, DELIVERED, FAILED, CANCELLED` — its own
state machine, deliberately not merged with `OrderStatus` (dispatch progress and kitchen progress
are different axes; see `docs/architecture.md` § 14). Legal transitions are whitelisted in
`DeliveryService.ALLOWED_TRANSITIONS`, the same pattern as every other status enum in this
codebase.

### DeliveryStatusHistory
`id, deliveryOrderId, fromStatus? (DeliveryStatus), toStatus (DeliveryStatus), changedByUserId?,
note?`. Append-only, one row per status change including creation (`fromStatus = null`) — the same
`*StatusHistory` pattern as `TableStatusHistory`/`ReservationStatusHistory`/`OrderStatusHistory`.

### DriverAssignment
`id, deliveryOrderId, driverId, assignedByUserId?, assignedAt (default now), unassignedAt?,
note?`. Append-only audit trail of *who was assigned when*, kept separate from both
`DeliveryOrder.driverId` (the current-value pointer used for everyday queries) and
`DeliveryStatusHistory` (the status timeline) — reassignment is its own timestamped event, not
just a status change or a value overwrite. `DeliveryService.assignDriver` closes out any row with
`unassignedAt: null` for the delivery before opening a new one, inside the same transaction, so at
most one row per `DeliveryOrder` is ever open at a time — verified by the migration smoke test and
an integration test asserting exactly one open assignment after a reassignment.

## Phase 7 Schema

### CateringPackage
`id, organizationId, branchId, name, description?, pricePerGuest (Decimal), minGuests?,
maxGuests?, active (default true)`. `@@unique([branchId, name])` — same per-branch-unique-name
pattern as `TableSection`/`DeliveryZone`. Optional — an inquiry/quote can reference a package for
per-guest food pricing, or skip it and rely entirely on the quote's flat fee fields.

### CateringInquiry
`id, organizationId, branchId, customerUserId? (FK to User, ON DELETE SET NULL), guestName?,
guestEmail?, guestPhone?, eventType, eventDate, location, guestCount, packageId? (FK to
CateringPackage, ON DELETE SET NULL), menuRequirements?, equipmentRequests?, staffRequests?,
setupRequests?, deliveryRequested (default false), deliveryAddress?, specialRequests?, status
(CateringInquiryStatus, default NEW)`. Same optional-`customerUserId`-plus-guest-snapshot pattern
as `Order`/`Reservation` — a catering lead may or may not come from a registered customer.
`CateringInquiryStatus` enum: `NEW, QUOTED, CONVERTED, CANCELLED`.

### CateringQuote
`id, organizationId, branchId, inquiryId (FK to CateringInquiry, ON DELETE CASCADE), packageId?
(ON DELETE SET NULL), guestCount, foodTotal/staffingTotal/equipmentTotal/transportationTotal/
setupTotal/serviceFeeTotal/discountTotal/taxTotal/total (all Decimal, default 0), status
(CateringQuoteStatus, default DRAFT), sentAt?, viewedAt?, respondedAt?, expiresAt?,
rejectionReason?, cancellationReason?`. `foodTotal`/`taxTotal`/`total` are always server-computed
by `CateringService.computeQuoteTotals` from the item list, fee inputs, and the tax rate — never
accepted directly from the client (see `lib/validation/catering.ts`, which deliberately omits
those three fields from `createCateringQuoteSchema`). `CateringQuoteStatus` enum: `DRAFT, SENT,
VIEWED, ACCEPTED, REJECTED, EXPIRED, CANCELLED` — whitelisted transitions in
`CateringService.QUOTE_ALLOWED_TRANSITIONS`, `rejectionReason`/`cancellationReason` required by
the service (not the DB) before `REJECTED`/`CANCELLED`.

### CateringQuoteItem
`id, quoteId (FK to CateringQuote, ON DELETE CASCADE), description, quantity (default 1),
unitPrice (Decimal), lineTotal (Decimal)`. The only itemized line category on a quote — see
`docs/architecture.md` § 15 for why staffing/equipment/transportation/setup/service-fee stay flat
columns instead of their own itemized tables.

### CateringEvent
`id, organizationId, branchId, quoteId (@unique, FK to CateringQuote, ON DELETE RESTRICT),
customerUserId? (ON DELETE SET NULL), guestName?/guestEmail?/guestPhone?, eventType, eventDate,
location, guestCount, status (CateringEventStatus, default SCHEDULED), total (Decimal),
depositAmount (Decimal, default 0), notes?, cancellationReason?`. The `@unique quoteId` is the
DB-enforced guarantee that a quote can never be accepted into two events — the same "constraint,
not just application logic" discipline as Phase 3's double-booking `EXCLUDE` constraint and Phase
4's one-active-invoice partial index. The quote FK is `RESTRICT` (an event's originating quote can
never be deleted out from under it — quotes with a live event are permanent history, same
reasoning as `DeliveryZone`'s `RESTRICT` FK). Auto-created by
`CateringService.updateQuoteStatus`'s `ACCEPTED` transition, never directly by an API caller.
`CateringEventStatus` enum: `SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED` — whitelisted
transitions in `CateringService.EVENT_ALLOWED_TRANSITIONS`, `cancellationReason` required before
`CANCELLED`.

### CateringEventItem
`id, eventId (FK to CateringEvent, ON DELETE CASCADE), description, quantity, unitPrice,
lineTotal`. A snapshot copy of the accepted quote's `CateringQuoteItem` rows at accept-time —
later edits to the (now-terminal) quote can't happen anyway once it's not `DRAFT`, but this keeps
the event's own item list independently readable without joining back through the quote.

### CateringPayment
`id, organizationId, branchId, eventId (FK to CateringEvent, ON DELETE CASCADE), type
(CateringPaymentType), method (OrderPaymentMethod, reused), amount (Decimal), status
(OrderPaymentStatus, reused, default COMPLETED), note?, recordedByUserId?`. A real child table
(unlike `Reservation`'s single deposit field) because a catering event routinely takes more than
one payment — see `docs/architecture.md` § 15. `CateringPaymentType` enum: `DEPOSIT, BALANCE` —
the only genuinely new payment enum this phase adds; method/status are reused directly from
Phase 4's `OrderPaymentMethod`/`OrderPaymentStatus` rather than duplicated.

## Phase 8 Schema

### Customer
`id, organizationId, userId? (@unique, FK to User, ON DELETE SET NULL), firstName, lastName?,
email?, phone?, dateOfBirth?, status (CustomerStatus, default ACTIVE)`. Organization-scoped, not
branch-scoped, matching §9's literal field list. `userId` is nullable and unique — most customers
(walk-ins, guest orders) never link to a `User` login account; the minority who do register get a
1:1 link. `CustomerStatus` enum: `ACTIVE, INACTIVE, BLOCKED` — a staff-set administrative flag,
orthogonal to the RFM segment computed live in `lib/crm/rfm.ts` (see `docs/architecture.md` § 16).
Indexed on `organizationId`, `[organizationId, email]`, and `[organizationId, phone]` for lookup.

### CustomerAddress
`id, customerId (FK to Customer, ON DELETE CASCADE), label?, line1, line2?, city?, province?,
postalCode?, country (default "PH"), isDefault (default false)`. Multiple addresses per customer;
`CustomerService.addAddress`/`updateAddress` enforce single-default exclusivity in application
code (clearing any other `isDefault` row via `updateMany` inside the same transaction) rather than
a DB constraint, since "at most one default" across a nullable boolean isn't expressible as a
simple unique index the way Phase 4's partial-unique-index pattern handled "one active invoice."

### CustomerPreference
`id, customerId (FK to Customer, ON DELETE CASCADE), key, value`. Free-form key/value pairs
("dietary: No seafood", "seating: Window preferred") rather than a fixed column set, since the
master spec doesn't enumerate what preferences to track. `@@unique([customerId, key])` — set via
upsert, so re-setting the same key updates rather than duplicates.

### CustomerNote
`id, customerId (FK to Customer, ON DELETE CASCADE), authorUserId? (FK to User, ON DELETE SET
NULL), note, createdAt`. Append-only staff notes — no update/edit path, matching how notes work in
every other system that treats them as a timestamped log rather than a mutable field.

### CustomerTag
`id, customerId (FK to Customer, ON DELETE CASCADE), tag, createdByUserId? (FK to User, ON DELETE
SET NULL)`. `@@unique([customerId, tag])` — duplicate tags rejected by `CustomerService.addTag`
before the DB constraint would even be hit, so the caller gets a clear `ConflictError` rather than
a raw Prisma unique-violation.

### CustomerReview
`id, organizationId, branchId? (FK to Branch, ON DELETE SET NULL), customerId? (FK to Customer, ON
DELETE SET NULL), orderId? / reservationId? / cateringEventId? (all ON DELETE SET NULL), rating
(Int, 1-5), comment?, recordedByUserId? (FK to User, ON DELETE SET NULL)`. Every link is optional
and independently nullable — a review can stand alone (a walk-in comment card with no linked
record) or attach to any combination of customer/order/reservation/event. `rating` is enforced
1-5 by a hand-written migration `CHECK` constraint (Prisma's schema DSL has no CHECK support — the
same gap Phase 3's `EXCLUDE` constraint and Phase 4's partial unique index hit) plus a matching
Zod bound in `lib/validation/crm.ts`. This model has no spec-level field list anywhere in the
master build prompt — the Phase 8 build list just says "Reviews" — so its shape is this build's
own design, documented as such rather than presented as a literal requirement.

### customerId on Order / Reservation / CateringInquiry / CateringEvent
Each of these four tables gained a nullable `customerId` column (FK to `Customer`, `ON DELETE SET
NULL` — deleting a `Customer` profile preserves the transaction history, it just un-links it). The
Prisma relation field is named `crmCustomer`, not `customer`, to stay visually distinct from each
model's pre-existing `customer`/`customerUserId` relation (the optional login-account link). On
`Order`/`Reservation`/`CateringInquiry` this column is client-settable, validated against the
caller's own organization by `CustomerService.assertCustomerInOrg` before the row is created. On
`CateringEvent` it is **not** client-settable — `CateringService.updateQuoteStatus`'s `ACCEPTED`
transition copies it automatically from `CateringQuote.inquiry.customerId`, the same "the event
inherits from its inquiry" logic already used for guest contact fields. None of the four columns
are ever auto-populated by matching a guest's name/email/phone against existing customers — see
`docs/architecture.md` § 16 for why that was deliberately not built.

### Organization.crmSettings
A nullable `Json` column added to the existing `Organization` table, mirroring the
`Branch.openingHours` pattern from Phase 1: `null` means "use `DEFAULT_RFM_THRESHOLDS`"; a present
value's `rfmThresholds` key can override any subset of the six RFM threshold fields, validated and
merged field-by-field by `lib/crm/rfm.ts`'s `resolveRfmThresholds` (a malformed or out-of-range
override for one field silently falls back to that field's own default).

## Phase 9 Schema

### Unit
`id, organizationId, name, abbreviation, baseUnitId? (self-FK "UnitConversion", ON DELETE
RESTRICT), conversionFactor (Decimal(14,6), default 1)`. Organization-scoped. `baseUnitId = null`
means this is a base unit (kg, L, pc); a non-null `baseUnitId` means this unit is derived from
that base, with `conversionFactor` = how many of this unit equal one of the base (e.g.
`Gram.conversionFactor = 1000`). Depth is capped at one level (a derived unit's own base must
itself be a base unit) — enforced in `lib/inventory/units.ts`/`InventoryService`, not the
database. `@@unique([organizationId, abbreviation])`.

### Ingredient
`id, organizationId, name, stockUnitId (FK to Unit, ON DELETE RESTRICT), costPerUnit
(Decimal(12,4), default 0), active (default true)`. Organization-scoped catalog entry — "Chicken"
means the same thing at every branch; how much of it is on hand does not. `costPerUnit` reflects
the most recent purchase price ("last purchase cost wins"), updated by
`InventoryService.receivePurchaseOrderItems` on every PO receipt.

### Recipe / RecipeItem
`Recipe`: `id, organizationId, menuItemId (@unique, FK to MenuItem, ON DELETE CASCADE),
yieldQuantity (Decimal(10,2), default 1), notes?`. One recipe per menu item (defined at the item
level, not per-variant/modifier — see `docs/architecture.md` § 17's scope-boundary note).
`RecipeItem`: `id, recipeId (ON DELETE CASCADE), ingredientId (ON DELETE RESTRICT), quantity
(Decimal(12,4)), unitId (ON DELETE RESTRICT)`. `@@unique([recipeId, ingredientId])` — an ingredient
may only appear once per recipe; `InventoryService.assertRecipeItemsValid` rejects a duplicate
before the DB constraint is even reached.

### InventoryItem
`id, organizationId, branchId (ON DELETE CASCADE), ingredientId (ON DELETE RESTRICT),
quantityOnHand (Decimal(14,4), default 0), reorderPoint? (Decimal(14,4)), criticalPoint?
(Decimal(14,4))`. Branch-scoped — the real stock line. `@@unique([branchId, ingredientId])` — one
stock line per ingredient per branch. `quantityOnHand` is written exactly once, by
`InventoryService`'s private `applyTransaction` helper, via Prisma's atomic `increment` operator
(never read-then-write) — see `docs/architecture.md` § 17. `reorderPoint`/`criticalPoint` are
independently nullable thresholds driving the `OK`/`LOW`/`CRITICAL` classification
(`InventoryService.stockLevel`); `criticalPoint` may not exceed `reorderPoint` when both are set.

### InventoryTransaction
`id, organizationId, branchId (ON DELETE CASCADE), inventoryItemId (ON DELETE CASCADE), type
(InventoryTransactionType), quantityDelta (Decimal(14,4)), quantityAfter (Decimal(14,4)),
unitCostAtTime? (Decimal(12,4)), referenceType?, referenceId?, note?, recordedByUserId? (ON DELETE
SET NULL), createdAt`. The append-only ledger — every single change to any `InventoryItem`'s
`quantityOnHand` produces exactly one row here, in the same database transaction as the balance
change. `InventoryTransactionType` enum: `PURCHASE, SALE_CONSUMPTION, WASTE, ADJUSTMENT, RETURN,
TRANSFER, COUNT_CORRECTION` — the seven values master spec §14 lists verbatim, all real reachable
code paths (see `docs/architecture.md` § 17 for which service method produces each). `referenceType`/
`referenceId` loosely link back to the record that caused the transaction (a `PurchaseOrder`, an
`Order`, a `WasteRecord`, a `StockCount`) without a typed polymorphic FK. Indexed on
`[inventoryItemId, createdAt]` (running-balance queries) and `[referenceType, referenceId]`
(look up every transaction a given order/PO/count produced).

### Supplier
`id, organizationId, name, contactName?, email?, phone?, address?, active (default true)`.
Organization-scoped — a supplier serves the whole business, not one branch, unlike the
`PurchaseOrder` rows that reference it. `@@unique([organizationId, name])`.

### PurchaseOrder / PurchaseOrderItem
`PurchaseOrder`: `id, organizationId, branchId (ON DELETE CASCADE), supplierId (ON DELETE
RESTRICT), status (PurchaseOrderStatus, default DRAFT), total (Decimal(12,2), default 0),
expectedAt?, submittedAt?, receivedAt?, notes?, cancellationReason?, createdByUserId? (ON DELETE
SET NULL)`. `PurchaseOrderStatus` enum: `DRAFT, SUBMITTED, PARTIALLY_RECEIVED, RECEIVED,
CANCELLED`. Only a `DRAFT` order may be edited or submitted; only `SUBMITTED`/`PARTIALLY_RECEIVED`
may receive stock; only `DRAFT`/`SUBMITTED` may be cancelled. `PurchaseOrderItem`: `id,
purchaseOrderId (ON DELETE CASCADE), ingredientId (ON DELETE RESTRICT), unitId (ON DELETE
RESTRICT), quantityOrdered (Decimal(14,4)), quantityReceived (Decimal(14,4), default 0), unitCost
(Decimal(12,4)), lineTotal (Decimal(12,2))`. Receiving is partial-first-class:
`quantityReceived` accumulates across multiple receipts, and the order only becomes `RECEIVED`
once every line is fully received. The PO's ordering unit does not need to match the ingredient's
stock unit — `InventoryService.receivePurchaseOrderItems` converts via `lib/inventory/units.ts` and
derives `costPerStockUnit` from the receipt's own numbers to avoid compounding conversion rounding.

### StockCount / StockCountItem
`StockCount`: `id, organizationId, branchId (ON DELETE CASCADE), status (StockCountStatus, default
OPEN), notes?, recordedByUserId? (ON DELETE SET NULL), completedAt?`. `StockCountStatus` enum:
`OPEN, COMPLETED, CANCELLED`. `StockCountItem`: `id, stockCountId (ON DELETE CASCADE),
inventoryItemId (ON DELETE RESTRICT), expectedQuantity (Decimal(14,4)), countedQuantity?
(Decimal(14,4))`. `@@unique([stockCountId, inventoryItemId])`. Opening a count snapshots every
current `InventoryItem.quantityOnHand` at the branch into `expectedQuantity` — but that snapshot is
used for variance *reporting* only; the `COUNT_CORRECTION` transaction `completeStockCount` writes
is based on each item's *current* `quantityOnHand` at completion time, not this stale open-time
value — see `docs/architecture.md` § 17 for why. A count only flips to `COMPLETED` once every line
has a non-null `countedQuantity`; partial completion is supported and leaves it `OPEN`.

### WasteRecord
`id, organizationId, branchId (ON DELETE CASCADE), inventoryItemId (ON DELETE RESTRICT), quantity
(Decimal(14,4)), reason, recordedByUserId? (ON DELETE SET NULL), createdAt`. Each waste record
pairs with exactly one `WASTE` `InventoryTransaction` (negative `quantityDelta`, `unitCostAtTime`
stamped from the ingredient's current `costPerUnit` at time of waste).

## Phase 10 Schema

### ChartOfAccount
`id, organizationId, code, name, type (AccountType), normalBalance (DebitCredit), description?,
isSystem (default true), active (default true)`. Organization-scoped, seeded per-organization
(master spec §28's 30-account list verbatim, plus one added "Waste" expense account — see
`docs/architecture.md` § 18) by `AccountingService.ensureChartOfAccounts`, called from
`AuthService.register`. `AccountType` enum: `ASSET, LIABILITY, EQUITY, REVENUE, COGS, EXPENSE`.
`DebitCredit` enum: `DEBIT, CREDIT` — `normalBalance` is derivable from `type` but stored
explicitly so balance queries never need a hardcoded type→side switch. `@@unique([organizationId,
code])`, `@@unique([organizationId, name])`. Deleting an account referenced by any posted
`JournalEntryLine` is blocked (`ON DELETE RESTRICT`).

### AccountingPeriod
`id, organizationId, startDate, endDate, status (AccountingPeriodStatus, default OPEN), closedAt?,
closedByUserId? (ON DELETE SET NULL)`. A calendar-month bucket (`startDate` always the 1st,
`endDate` the last instant of the month), lazily created the first time an entry needs to post
into that month (`AccountingService.resolvePeriodForDate`). `AccountingPeriodStatus` enum: `OPEN,
CLOSED`. `@@unique([organizationId, startDate])`. Closing refuses if any `DRAFT` entry is still
dated inside the period; once `CLOSED`, no new or reversing entry may date into it again.

### JournalEntry / JournalEntryLine
`JournalEntry`: `id, organizationId, branchId? (ON DELETE CASCADE), periodId (ON DELETE RESTRICT),
entryDate, description, referenceType?, referenceId?, status (JournalEntryStatus, default DRAFT),
reversalOfEntryId? (@unique, self-FK "JournalEntryReversal"), postedAt?, postedByUserId? (ON
DELETE SET NULL), createdByUserId? (ON DELETE SET NULL)`. `JournalEntryStatus` enum: `DRAFT,
POSTED, REVERSED`. `branchId` is nullable — a manual entry can be org-wide (e.g. an owner capital
contribution) or scoped to one branch; every automatic posting from a branch-scoped business event
carries its branch. `JournalEntryLine`: `id, journalEntryId (ON DELETE CASCADE), accountId (ON
DELETE RESTRICT), debit (Decimal(14,2), default 0), credit (Decimal(14,2), default 0),
description?`. A `CHECK` constraint (`journal_entry_lines_debit_xor_credit_check`) enforces
`(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)` — exactly one side positive, never both,
never neither — at the database level, not just in application code.
`AccountingService.assertBalanced` additionally requires `SUM(debit) = SUM(credit)` across an
entry's lines before it can ever be created or posted (master spec §27/§49's core invariant). A
`POSTED` entry is never edited; correction is only ever via `reverseJournalEntry`, which creates a
new `POSTED` entry with every line's debit/credit swapped and flips the original to `REVERSED` —
see `docs/architecture.md` § 18. Indexed on `[organizationId]`, `[branchId]`, `[periodId]`, and
`[referenceType, referenceId]` (look up every entry a given order/reservation/payment/PO/waste
record produced).

### FinancialTransaction
`id, organizationId, branchId? (ON DELETE CASCADE), type (FinancialTransactionType),
referenceType, referenceId, journalEntryId (@unique, ON DELETE CASCADE)`.
`FinancialTransactionType` enum: `ORDER_REVENUE, ORDER_COGS, DEPOSIT_RECEIVED, DEPOSIT_REFUNDED,
DEPOSIT_EARNED, INVENTORY_PURCHASE, INVENTORY_WASTE, EXPENSE_POSTED`. The idempotency/link layer
master spec §47 requires: `@@unique([referenceType, referenceId, type])` means a repeated business
event (a retried request, a duplicate webhook) cannot create a duplicate journal entry for the
same `(what happened, to what, what kind)` triple — see `docs/architecture.md` § 18 for the PO
-receiving idempotency-key design decision this enables.

### ExpenseCategory / Vendor / Expense / ExpenseAttachment
`ExpenseCategory`: `id, organizationId, name, defaultAccountId? (FK to ChartOfAccount, ON DELETE
SET NULL), active (default true)`. `@@unique([organizationId, name])`. `defaultAccountId` is the
account an expense in this category posts to on approval; a category with none configured cannot
have its expenses approved (`AccountingService.approveExpense` refuses rather than guessing).
`Vendor`: `id, organizationId, name, contactName?, email?, phone?, address?, active (default
true)`. `@@unique([organizationId, name])`. Kept deliberately separate from Phase 9's `Supplier` —
a `Supplier` sells ingredients (feeds `PurchaseOrder`/Inventory/Accounts Payable), a `Vendor` is
billed for general business overhead (feeds `Expense`). `Expense`: `id, organizationId, branchId
(ON DELETE CASCADE), vendorId? (ON DELETE SET NULL), categoryId (ON DELETE RESTRICT), amount
(Decimal(12,2)), expenseDate, paymentMethod (OrderPaymentMethod, reused from Phase 4), notes?,
approvalStatus (ExpenseApprovalStatus, default PENDING), recordedByUserId? (ON DELETE SET NULL),
approvedByUserId? (ON DELETE SET NULL), journalEntryId? (@unique, ON DELETE SET NULL)`.
`ExpenseApprovalStatus` enum: `PENDING, APPROVED, REJECTED`. Created `PENDING`; `approveExpense`
posts Debit `category.defaultAccountId` / Credit Cash-or-Bank (by `paymentMethod`) and sets
`journalEntryId`; `rejectExpense` sets `REJECTED` and never touches the ledger. `ExpenseAttachment`:
`id, expenseId (ON DELETE CASCADE), fileName, fileUrl, uploadedByUserId? (ON DELETE SET NULL)`.

## Phase 11 Schema

No new tables — Phase 11 (Financial Reporting) is pure read/aggregation over Phase 10's ledger
(`services/reporting/ReportingService.ts`), reading `JournalEntry`/`JournalEntryLine`/
`ChartOfAccount` directly rather than any new storage. Two columns were added to the existing
`ChartOfAccount` table (migration `20260817010000_phase11_reporting`):

### ChartOfAccount (additions)
`isCashEquivalent (Boolean, default false)`, `cashFlowCategory (CashFlowCategory?, nullable)`.
`CashFlowCategory` enum: `OPERATING, INVESTING, FINANCING`. `isCashEquivalent` is true only for
the seeded Cash and Bank accounts — it marks which accounts `generateCashFlow` treats as "cash"
for its direct-method walk and which balances the dashboard's Cash Position figure sums.
`cashFlowCategory` classifies every other account for when it's the contra side of a cash
movement; null for cash-equivalent accounts themselves and for any account an org adds without
classifying it (its cash impact is then reported under `unclassifiedActivities` rather than
silently dropped — see `docs/architecture.md` § 19). The seeded chart's classification: Accounts
Receivable/Inventory/Accounts Payable/Customer Deposits/Taxes Payable and every Revenue/COGS/
Expense account → `OPERATING`; Equipment → `INVESTING`; Loans/Owner's Equity/Retained Earnings →
`FINANCING`. `AccountingService.createAccount` defaults a new custom account's
`cashFlowCategory` by type (`EQUITY` → `FINANCING`, everything else → `OPERATING`) unless the
caller overrides it; `isCashEquivalent` is not settable at creation (an org enables it on an
existing account via `updateAccount` if it adds a second cash-equivalent account, e.g. a GCash
wallet).

## Phase 12 Schema

No new tables or columns — Phase 12 (Owner Analytics) is pure read/aggregation over existing
tables via `services/analytics/AnalyticsService.ts`, split by dashboard: `getRevenueDashboard`
reads `Order`/`CateringPayment`; `getProfitDashboard` reuses Phase 11's `ReportingService`
(`generateIncomeStatement`) against the existing ledger rather than reading any table directly;
`getCustomerAnalytics` reads `Customer`/`Order` (reusing `CustomerService.segmentBreakdown`);
`getProductAnalytics` reads `OrderItem`/`MenuItem`; `getChannelAnalytics` reads `Order`/
`CateringEvent`; `getInventoryAnalytics` reads `WasteRecord`/`Ingredient`/`PurchaseOrder`/
`InventoryTransaction` (and calls `InventoryService.getLowStockItems` per branch); and
`getOperationalAnalytics` reads `Reservation`/`CateringEvent`/`Delivery`/`RestaurantTable`/
`Order`/`OrderStatusHistory`. See `docs/architecture.md` § 20 for the full data-sourcing
rationale, the trend-bucketing/reconciliation design, and the catering revenue-recognition
timing convention this phase relies on.

## Forward-Looking Schema (not created yet)

The following table groups are specified in the master build prompt and will be added in their
respective phases, each with its own migration and tests:

- Not scheduled to a specific phase: `payments`, `payment_transactions`, `refunds`,
  `payment_webhooks` (master spec §24/§25's external payment-gateway integration layer). Judged
  out of Phase 10's scope — Phase 4's `OrderPayment` model plus the `lib/payments/PaymentProvider.ts`
  abstraction stub already cover this build's "staff records that money changed hands" needs, and
  a real external gateway integration (webhooks, provider-specific transaction states) is
  meaningfully more scope than any phase's build list calls for today. Revisit only if a real
  payment gateway integration becomes a concrete requirement.

Introducing all of these now, before the services that use them exist, would violate the "do not
build in one uncontrolled pass" rule and leave untested tables in the schema — they're documented
here so the full data model is visible, but created migration-by-migration as each phase lands.

## Migrations

Run `npx prisma migrate dev --name <description>` for every schema change. Never edit a generated
migration file after it has been applied to a shared database — write a new migration instead.
`npx prisma migrate deploy` is used in production (see `docs/deployment.md`, added in Phase 16).
