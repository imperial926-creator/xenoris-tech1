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

## Forward-Looking Schema (not created yet)

The following table groups are specified in the master build prompt and will be added in their
respective phases, each with its own migration and tests:

- Phase 3: `reservations`, `reservation_guests`, `reservation_tables`, `reservation_payments`,
  `reservation_status_history`
- Phase 4: `orders`, `order_items`, `order_item_modifiers`, `order_status_history`, `invoices`,
  `invoice_items`, `invoice_sequences`
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
