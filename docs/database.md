# Database

PostgreSQL, managed via Prisma (`prisma/schema.prisma`). See that file for the authoritative
schema; this document explains the conventions and the current (Phase 1) scope.

## Conventions

- IDs: `cuid()`, field name `id`.
- Every tenant-scoped model has `organizationId String` with a `@relation` to `Organization` and
  a `@@index([organizationId])`.
- Timestamps: `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`.
- Soft delete: `deletedAt DateTime?` on models that participate in financial/audit history
  (e.g. `User`). Hard delete is reserved for models with no downstream referential/financial
  impact.
- Money: `Decimal` with explicit precision/scale, never `Float`. (No money fields exist yet in
  Phase 1 — this applies starting Phase 4/9/10.)
- Enums: Prisma `enum` for closed status sets (`UserStatus`, later `OrderStatus`,
  `PaymentStatus`, etc.).
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

## Forward-Looking Schema (not created yet)

The following table groups are specified in the master build prompt and will be added in their
respective phases, each with its own migration and tests — they are intentionally **not** in the
Phase 1 migration:

- Phase 2: `table_sections`, `restaurant_tables`, `table_status_history`, `menu_categories`,
  `menu_items`, `menu_item_variants`, `menu_modifiers`, `menu_item_modifiers`
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
