# CLAUDE.md — Project Source of Truth

This file is the authoritative reference for this codebase. Update it whenever architecture or
significant implementation decisions change. Do not rely on conversation memory — this repo is
the source of truth.

## Product Purpose

A production-grade, multi-tenant restaurant business operating platform covering reservations,
table management, dine-in/take-out/delivery ordering, catering, kitchen operations, customer CRM,
inventory, payments, invoicing, double-entry accounting, live financial statements, business
analytics, notifications, and AI business intelligence. Built for eventual deployment to Web,
Android, and iOS, scalable to multiple restaurants/branches.

Default business locale for seed/demo data: **Philippines** (currency `PHP`, timezone
`Asia/Manila`). Currency and timezone are per-organization fields, not hard-coded — any
organization can run in a different locale.

## Architecture

Multi-tenant, hierarchical:

```
Organization
  └── Branches
        ├── Tables / Sections
        ├── Employees (Users with roles scoped to the org)
        ├── Menu (categories, items, modifiers)
        ├── Orders (dine-in / take-out / delivery)
        ├── Reservations
        ├── Inventory
        └── Finance (journal entries scoped to org, reportable per branch)
```

Every business record carries `organizationId` (and `branchId` where applicable) for tenant
isolation. All queries must be scoped by the authenticated user's organization — there is no
cross-tenant data access.

Business logic lives in `services/*`, never in React components or route handlers directly.
Route handlers under `app/api/**` are thin: validate input (Zod) → call a service → return a
response. Financial and inventory calculations are never trusted from the client.

## Technology Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, React 18, Tailwind CSS, shadcn/ui-style
  components, TanStack Query, React Hook Form, Zod.
- **Backend**: Next.js Route Handlers (API), TypeScript, service-layer architecture.
- **Database**: PostgreSQL, Prisma ORM (migrations + schema management).
- **Auth**: Credentials-based auth, bcrypt password hashing, signed session tokens (JWT) in
  HttpOnly cookies. Role-based authorization (RBAC) via `roles` / `permissions` /
  `role_permissions` / `user_roles`.
- **Testing**: Vitest (unit + integration), Playwright (e2e, pre-installed in this environment).

## Database Conventions

- Primary keys: `cuid()` string IDs (`id`).
- Every tenant-scoped table has `organizationId` (and `branchId` where relevant), indexed.
- Every table has `createdAt` / `updatedAt`. Tables that support soft delete have `deletedAt`
  (nullable) — never hard-delete business records that participate in financial or audit history.
- Foreign keys are enforced at the database level. No orphaned records.
- Money fields are stored as `Decimal` (never `Float`) to avoid floating-point rounding errors in
  financial calculations.
- Enums are modeled as Prisma `enum` types for statuses (order status, payment status, etc.).
- Every schema change goes through a Prisma migration — never hand-edit the database directly.

## Coding Conventions

- TypeScript strict mode. No `any` in service/business logic.
- Validate all external input with Zod at the API boundary before it reaches a service.
- Services are the only place allowed to talk to Prisma for business operations — no direct
  `prisma.*` calls from components or route handlers for anything beyond trivial reads.
- Multi-step writes that must succeed or fail together use `prisma.$transaction`.
- Never put pricing, tax, discount, inventory, or accounting math in a React component. That logic
  lives in `lib/accounting`, `lib/inventory`, or the relevant service, and is unit tested.

## Security Rules

- Passwords are hashed with bcrypt (cost factor 12). Plaintext passwords are never logged or
  stored.
- Sessions are signed JWTs in HttpOnly, Secure, SameSite=Lax cookies — never in `localStorage`.
- Every API route that mutates data checks authentication AND authorization (role/permission)
  before touching the database.
- All mutating input is validated server-side with Zod, regardless of client-side validation.
- Secrets (`AUTH_SECRET`, provider keys) are read from environment variables only, never
  hard-coded, never sent to the browser.
- Audit-relevant actions (auth, payments, refunds, journal entries, inventory adjustments, price
  changes, permission changes, reservation/order cancellations) are recorded in `audit_logs`.

## Financial / Accounting Rules

- Double-entry only. Every `journal_entries` record must have `journal_entry_lines` where
  `SUM(debits) = SUM(credits)`. Enforced in `AccountingService`, tested explicitly.
- Posted journal entries are immutable. Corrections are made via reversal entries, never by
  editing a posted entry.
- Customer deposits are recorded as a liability (`Customer Deposits`) on receipt, not as revenue.
  Revenue is recognized only when earned, per the configurable revenue-recognition policy.
- Financial reports (Income Statement, Balance Sheet, Cash Flow, Trial Balance) are generated from
  the ledger (`journal_entries` / `journal_entry_lines`), never from ad-hoc UI aggregation.
- **Not a substitute for professional advice.** Philippine BIR/VAT compliance, official invoicing
  sequences, payroll/withholding rules, and revenue-recognition timing are configurable but are
  flagged throughout for review by a licensed Philippine accountant / tax professional before
  going live. See `docs/accounting.md` (added in Phase 10) for the running list.

## Testing Rules

- Unit tests: pricing, tax, discounts, reservation availability, inventory math, accounting rules,
  RFM calculations.
- Integration tests: database operations, auth flows, org/branch tenant isolation.
- Accounting tests must assert `debits === credits` on every journal entry produced by the system.
- A feature is not "done" until it has UI + API + DB + business logic + authorization + error
  handling + tests + docs. Financial features additionally require an audit log entry and a
  reconciliation test.

## Deployment Rules

- Application: Vercel or equivalent Next.js host.
- Database: managed PostgreSQL (not the local dev instance).
- File storage: S3-compatible.
- Payments, email, SMS, push, and AI providers are all abstracted behind an interface
  (`lib/payments`, `lib/notifications`, `lib/ai`) — no provider is hard-coded. Until a provider is
  configured via environment variables, the integration must clearly report
  "Integration requires configuration" rather than fake success.

## Current Implementation Status

**Phase 0 — Discovery: done.** This document, `README.md`, `docs/architecture.md`,
`docs/database.md` created. Repository was empty at session start.

**Phase 1 — Foundation: done.**
- Next.js 14 + TypeScript + Tailwind + App Router project structure matching the target folder
  layout.
- Prisma schema: `Organization`, `Branch`, `User`, `Role`, `Permission`, `RolePermission`,
  `UserRole`, `AuditLog`.
- Auth: register/login/logout/me routes, bcrypt hashing, JWT session cookie, `AuthService`.
- RBAC: seeded roles (`CUSTOMER`, `STAFF`, `MANAGER`, `ACCOUNTANT`, `DRIVER`, `OWNER`,
  `ADMINISTRATOR`), permission model, `requirePermission` middleware helper.
- Organizations & Branches: `OrganizationService`, `BranchService`, CRUD API routes, tenant
  scoping.
- Minimal dashboard shell (sidebar nav for every planned module, most as "Phase N" placeholders —
  not fake data) and login page.
- Seed script: 1 organization, 2 branches, one user per role — clearly marked as demo data.
- Unit + integration tests for password hashing, RBAC permission checks, and org/branch tenant
  isolation.

**Phase 2 — Restaurant Configuration: done.**
- Prisma schema additions: `TableSection`, `RestaurantTable` (+ `TableStatus` enum),
  `TableStatusHistory`, `MenuCategory`, `MenuItem`, `MenuItemVariant`, `MenuModifierGroup` (+
  `ModifierSelectionType` enum), `MenuModifier`, `MenuItemModifierGroup`. `MenuModifierGroup` is a
  deliberate addition beyond the spec's literal table list — see `docs/database.md` for why a flat
  modifier list can't express "choose one Size" vs "choose any Add-ons."
- Permissions: `table:view`, `table:manage`, `menu:view`, `menu:manage`, granted to
  STAFF/MANAGER by default (STAFF can view+change table status but not edit the floor plan or
  menu pricing).
- `TableService`: sections, tables, and a whitelisted table-status state machine (e.g.
  `OUT_OF_SERVICE → OCCUPIED` is rejected server-side even if a client requests it), every
  transition recorded in `table_status_history`.
- `MenuService`: categories, items (Decimal pricing, never float), variants, modifier groups
  (SINGLE/MULTIPLE selection), modifiers, item↔modifier-group linking.
- API routes for all of the above under `/api/branches/[id]/sections`, `/api/branches/[id]/tables`
  (+ `/status`, `/status-history`), and `/api/menu/**`.
- Dashboard UI: a live table status board (branch selector, per-table status dropdown, add
  section/table forms) replacing the Phase 1 placeholder, a menu manager (categories, items,
  modifier groups/modifiers, item-modifier linking), and a business-hours editor on the Settings
  page (writes to `Branch.openingHours`, added in Phase 1).
- Seed data extended: 2 sections × 6 tables per branch (24 tables total), 4 menu categories, 14
  menu items, 1 variant, 2 modifier groups (Rice Size — required/single-select; Add-ons —
  multi-select) linked to a sample item.
- Unit tests: money/price validation (decimal-places, negative rejection), modifier-group
  selection-type rules, table status enum validation. Integration tests: table creation +
  status-transition state machine (legal and illegal moves), section delete SET NULL vs table
  delete CASCADE, menu category/item/variant/modifier CRUD, tenant isolation for both.
- One real routing bug caught and fixed during Phase 1 while building this phase's nav: see
  `docs/architecture.md` § 4a.

**Phase 3 — Reservations: done.**
- Prisma schema additions: `Reservation`, `ReservationTable` (join table, denormalizes
  `startAt`/`endAt`/`status` from the parent reservation), `ReservationStatusHistory`, plus
  `ReservationStatus` and `ReservationDepositStatus` enums. No `reservation_guests` or
  `reservation_payments` tables — guest contact info and deposit tracking are embedded directly on
  `Reservation` instead (see `schema.prisma`'s "Phase 3 — Reservations" comment block and
  `docs/database.md` for the full reasoning).
- **Double-booking prevention is enforced by Postgres itself**, not just application logic: a
  `btree_gist`-backed `EXCLUDE` constraint (`no_double_booking`) on `reservation_tables` rejects
  any two non-cancelled/no-show bookings of the same table with overlapping time ranges — hand
  -written in migration SQL since Prisma's schema DSL has no EXCLUDE support. Proven with a real
  two-session concurrent `psql` test (not just sequential assertions) — see Known Issues below.
- Permissions: `reservation:view`, `reservation:manage`, granted to STAFF/MANAGER by default
  (front-of-house staff take and manage reservations as a core part of the job, unlike table/menu
  editing).
- `ReservationService`: availability search (mirrors the DB constraint's overlap logic exactly),
  reservation creation with multi-table assignment and capacity validation, a whitelisted status
  state machine (`PENDING → CONFIRMED → SEATED → COMPLETED`, with `CANCELLED`/`NO_SHOW` branches;
  same "reject illegal transitions server-side" pattern as `TableService`), manual deposit
  recording (no payment gateway exists yet — staff attest money changed hands outside the system),
  and a soft business-hours check against `Branch.openingHours` using `Intl.DateTimeFormat`
  (no date library dependency, since this build environment cannot `npm install` one to verify it
  works).
- API routes under `/api/branches/[id]/reservations` (+ `/availability`, `/[reservationId]`,
  `/[reservationId]/status`, `/[reservationId]/deposit`, `/[reservationId]/status-history`).
- Dashboard UI: an availability search + booking form (pick a date/time/party size, select one or
  more tables, capture guest details and an optional deposit) and a reservation list with
  status-appropriate action buttons (Confirm/Seat/Complete/Cancel/No-show) and inline deposit
  recording, replacing the Phase 2 placeholder. Overview page gained a live "Reservations Today"
  card.
- Scope boundary: **staff-side dashboard only.** Public customer self-service booking needs
  customer-facing authentication, which doesn't exist yet (the current `/register` flow only
  creates org-owner accounts) — deferred to Phase 4 alongside customer ordering rather than
  building throwaway auth here.
- Seed data extended: 7 demo reservations spanning every status (PENDING, CONFIRMED w/ paid
  deposit, SEATED, COMPLETED, CANCELLED, NO_SHOW) across both branches, using offsets from seed
  time so PENDING/CONFIRMED are always in the future and terminal statuses are always in the past.
- Unit tests: reservation validation schemas (duration bounds, deposit-required-implies-amount,
  status enums). Integration tests: availability search (overlap + non-overlap), capacity
  validation, the full legal status lifecycle, illegal-transition rejection, cancellation
  -reason-required, cancellation freeing a table for rebooking, tenant isolation, manual deposit
  recording, and — the one genuinely new kind of test in this codebase — a **real concurrent
  double-booking test** using `Promise.allSettled` on two simultaneous `createReservation` calls
  for the same table/window, asserting exactly one succeeds and the loser fails with the DB's
  `ConflictError`, not a sequential simulation of concurrency.

**Phase 4 — Orders, Payments, Invoicing: done.**
- Prisma schema additions: `Order` (+ `OrderType`, `OrderStatus` enums), `OrderItem`,
  `OrderItemModifier`, `OrderStatusHistory`, `OrderPayment` (+ `OrderPaymentMethod`,
  `OrderPaymentStatus` enums), `Invoice` (+ `InvoiceStatus` enum), `InvoiceItem`,
  `InvoiceSequence`. `OrderItem`/`OrderItemModifier` snapshot `nameSnapshot` /
  `unitPriceSnapshot` / `priceDeltaSnapshot` at order time (same principle as Phase 3's
  reservation guest-contact snapshot) so later menu edits never rewrite order history. No
  separate `customers` table — dine-in/take-out/delivery orders can be tied to a `User` via
  `customerUserId` or captured as a walk-in guest (`guestName`/`guestEmail`/`guestPhone`), same
  "don't build a table the spec doesn't ask for yet" reasoning as Phase 2's modifier-group
  decision.
- **All pricing is computed server-side**, never trusted from the client: `OrderService`
  resolves menu item/variant/modifier prices from the database and validates modifier-group
  `required`/`minSelect`/`maxSelect` rules before computing line and order totals with
  `Prisma.Decimal` arithmetic. A provisional 12% PH VAT (`PROVISIONAL_VAT_RATE`) applies only to
  `STANDARD`-tax-category items — flagged, like the rest of this codebase's PH tax handling, as
  needing sign-off from a licensed Philippine accountant before real invoicing.
- Dine-in orders best-effort auto-transition their table to `OCCUPIED`, reusing `TableService`'s
  whitelisted status state machine; a table already `OUT_OF_SERVICE`/`CLEANING` rejects the new
  order. The table's status is re-read *inside* the database transaction (not from a
  pre-transaction snapshot) to avoid a read-then-write race — see Known Issues below.
- **Sequential per-branch invoice numbering (`INV-000001`, ...) is race-safe by construction**:
  `InvoiceService.issueInvoice` does an atomic `upsert` + `{ lastNumber: { increment: 1 } }` on a
  per-branch `InvoiceSequence` row inside the same transaction as the `Invoice` insert, relying
  on Postgres row-locking rather than a novel constraint. A different mechanism from Phase 3's
  double-booking `EXCLUDE` constraint because the guarantee needed is different ("assign the next
  number safely" vs. "reject an overlapping range") — proven with a genuine
  `Promise.allSettled` concurrency test, see Known Issues below.
- **Only one active (non-`VOID`) invoice per order is enforced by the database itself**: a
  partial unique index (`invoices_one_active_per_order`, `WHERE status != 'VOID'`) has no Prisma
  schema DSL representation — same category of gap as Phase 3's `EXCLUDE` constraint — hand
  -written in migration SQL and documented in `schema.prisma`'s comment block and
  `InvoiceService.translateDbError`.
- No payment gateway integration exists. `lib/payments/PaymentProvider.ts` defines the
  `PaymentProvider` interface (`PaymentIntentResult`, `RefundResult`) and an
  `UnconfiguredPaymentProvider` stub that throws on every method rather than faking success —
  this closes a documentation gap where `docs/architecture.md` referenced this file since Phase 1
  but it never actually existed. Payments actually taken today are **manually recorded**
  (`OrderPayment`, method CASH/CARD/GCASH/MAYA/BANK_TRANSFER/OTHER) the same "staff attests money
  changed hands" pattern as Phase 3's reservation deposits; `OrderService.paymentSummary`
  computes `paidAmount = Σ COMPLETED − Σ REFUNDED`, `balanceDue`, and `isFullyPaid` from that
  ledger.
- Permissions: no new permission keys were needed — `order:manage` (already existed from Phase 1,
  already granted to STAFF/MANAGER/OWNER/ADMINISTRATOR) is reused for every order and invoice
  endpoint.
- API routes under `/api/branches/[id]/orders` (+ `/[orderId]`, `/[orderId]/status`,
  `/[orderId]/payments`, `/[orderId]/invoice`) and `/api/branches/[id]/invoices` (+
  `/[invoiceId]`, `/[invoiceId]/void`).
- Dashboard UI: an order board (branch/status filters, a new-order form with menu item/variant/
  modifier selection and a live client-side estimated total, status-transition action buttons
  driven by the same whitelist as the service layer, inline cancellation-reason capture, payment
  recording, and an "Issue invoice" action once an order is fully paid) replacing the Phase 1
  placeholder, plus a new invoice board (branch selector, invoice list with line items, void with
  inline reason capture). Overview page gained a live "Orders Today" card.
- Scope boundary: **staff-side order management only** — kitchen display (Phase 5) and delivery
  dispatch (Phase 6) are explicitly out of scope here, as originally announced. Phase 3's
  wrap-up note had also floated customer-facing self-service ordering as a Phase 4 candidate;
  that is explicitly **re-scoped out of Phase 4** given the phase's already-large staff-side
  surface (schema + pricing engine + state machine + invoicing + concurrency-proven sequencing)
  and deferred to a later dedicated pass once customer-facing authentication exists — see
  `docs/architecture.md` § 13 for the full reasoning.
- Seed data extended: 6 demo orders spanning every status and all three order types across both
  branches (a fully-paid, invoiced dine-in order; a ready take-out order; a preparing delivery
  order; a pending dine-in order; a cancelled take-out order; a confirmed dine-in order on the
  second branch), with hand-computed VAT-inclusive pricing so the numbers are independently
  checkable.
- Unit tests: order/payment/invoice validation schemas (delivery-address-required-for-DELIVERY,
  quantity bounds, payment-method enum, malformed money strings). Integration tests: server-side
  pricing with exact Decimal snapshot assertions (including variant pricing and modifier
  totals), cross-org menu item / unlinked-modifier / maxSelect-exceeded rejection, table
  auto-transition to `OCCUPIED` (including a second order at an already-`OCCUPIED` table
  succeeding, and an `OUT_OF_SERVICE` table being rejected), the full legal order-status
  lifecycle, illegal-transition and missing-cancellation-reason rejection, payment recording +
  refund math, tenant isolation. Invoice tests: unpaid-order rejection, sequential numbering
  across multiple orders, duplicate-active-invoice rejection, void-then-reissue getting the next
  number, and — mirroring Phase 3's double-booking concurrency test — a **real concurrent
  invoice-issuance test** issuing invoices for 5 fully-paid orders on the same branch genuinely
  simultaneously (`Promise.allSettled`), asserting all 5 succeed with unique, correctly
  -sequential numbers.

**Phase 5 — Kitchen Display System: done.**
- Prisma schema addition: one nullable column, `Order.requiredAt`, for the spec's "Required
  time." **No new tables.** The master spec's Kitchen Display section (§20) asks for a dashboard
  over the existing order lifecycle (NEW → ACCEPTED → PREPARING → READY), not a parallel data
  model — that maps exactly onto the `OrderStatus` values `PENDING`/`CONFIRMED`/`PREPARING`/
  `READY` Phase 4 already built and tested. A second `KitchenTicketStatus` enum kept in sync with
  `OrderStatus` would be two sources of truth for one state machine; deliberately not built. See
  the "Phase 5 — Kitchen Display System" comment block in `schema.prisma`.
- `KitchenService` is intentionally thin: `getQueue` is a kitchen-shaped read model (active
  tickets only — `PENDING`/`CONFIRMED`/`PREPARING`/`READY`, excludes `COMPLETED`/`CANCELLED`,
  oldest first) and `advanceStatus` resolves "what's the next kitchen stage from here" and then
  delegates the actual transition to `OrderService.updateStatus` — the legality of every
  transition is checked exactly once, by `OrderService`'s own whitelist, never duplicated.
- No new permissions needed: `kitchen:view` was already declared in the permission catalog back
  in Phase 1 (as a forward-looking placeholder) and already granted to STAFF/MANAGER/OWNER/
  ADMINISTRATOR — Phase 5 is the first phase to actually wire it into an authorization check (the
  read-only queue endpoint). Advancing a ticket's status reuses `order:manage`, the same
  permission the general order-status endpoint already required in Phase 4, since it's the same
  underlying mutation.
- API routes: `GET /api/branches/[id]/kitchen/queue` (kitchen:view) and
  `POST /api/branches/[id]/kitchen/orders/[orderId]/advance` (order:manage).
- Dashboard UI: a real kitchen board (`/dashboard/kitchen`) with one column per kitchen stage
  (New/Accepted/Preparing/Ready), each ticket showing order number, type, table, items with
  modifiers and per-item notes, order-level special-instruction notes, elapsed time since
  creation, and an overdue indicator once `requiredAt` has passed — replacing the Phase 1
  placeholder. Overview page gained a live "Kitchen Queue" card.
- **Real-time updates are client-side polling, not push.** No WebSocket/Pusher/SSE infrastructure
  is configured in this build — same "no fake integrations, report unconfigured honestly" rule
  Deployment Rules already applies to payments/email/SMS/push. The kitchen board polls its queue
  endpoint every 7 seconds, which is the practical option available without adding unconfigured
  infrastructure; a real push channel (Server-Sent Events off the existing API routes, or a
  managed pub/sub provider) is a reasonable future upgrade, not built here.
- Seed data extended: two of Phase 4's existing seeded orders now carry a `requiredAt` (one 20
  minutes overdue on a still-READY ticket, one 30 minutes out and on-time) so the kitchen board
  has a meaningful overdue example without inventing new fake orders beyond what Phase 4 already
  seeded.
- Unit tests: `requiredAt` accepted/optional/rejected-when-empty on `createOrderSchema`.
  Integration tests: queue filtering (active statuses only, tenant isolation, oldest-first
  ordering), `advanceStatus` walking PENDING→CONFIRMED→PREPARING→READY one step at a time,
  rejection of advancing an order already at READY or CANCELLED, tenant isolation on
  `advanceStatus`, and `requiredAt` round-tripping through order creation into the queue read
  model (plus `OrderService.createOrder` rejecting an unparseable `requiredAt` string).

**Phase 6 — Delivery: done.**
- Prisma schema additions: `Order.deliveryFee` (so a delivery's fee is actually part of what the
  customer is charged — folded into `Order.total` via a modified `computeOrderTotals`, not just
  decorative data on a side table), plus five new tables — `DeliveryZone`, `Driver`,
  `DeliveryOrder`, `DeliveryStatusHistory`, `DriverAssignment` — and a new `DeliveryStatus` enum.
  See the "Phase 6 — Delivery" comment block in `schema.prisma` for the five numbered design
  decisions in full; the short version: `DeliveryOrder` is a 1:1 companion table to `Order` (per
  master spec §18's explicit `delivery_orders` table), auto-created in the same transaction as
  order creation whenever `type === 'DELIVERY'`; dispatch progress gets its own `DeliveryStatus`
  state machine, deliberately **not** merged with `OrderStatus` (contrast with Phase 5's KDS,
  which deliberately *does* reuse `OrderStatus` — dispatch and kitchen progress are genuinely
  different axes); `Driver` is a separate operational profile table, not just the DRIVER role
  ("role grants capability, profile carries domain data" — the same split Order/Reservation use
  for `customerUserId`); `DriverAssignment` is an append-only audit trail, separate from
  `DeliveryOrder.driverId`'s current-value pointer, same pattern as `TableStatusHistory`/
  `OrderStatusHistory`.
- `DeliveryZoneService`/`DriverService`/`DeliveryService` follow the same
  service-layer-owns-the-transaction, `assertBranchInOrg`-gated, audit-logged pattern as every
  prior phase. `DeliveryService`'s status whitelist (`ALLOWED_TRANSITIONS`) requires a driver
  assigned before `PICKED_UP` and a `note` before `CANCELLED`/`FAILED`; `assignDriver` closes out
  any currently-open `DriverAssignment` and opens a new one inside the same transaction, so
  reassignment always leaves exactly one open assignment row.
- **Driver-scoped access control (master spec §19):** a dedicated, non-branch-nested
  `GET /api/deliveries/mine` endpoint derives `organizationId`/`userId` only from the session,
  never from client-supplied params, and `DeliveryService.myDeliveries` resolves the caller's own
  `Driver` profile via `DriverService.getByUserId` before filtering — a driver cannot see another
  driver's queue by guessing an ID.
- Permissions: no new permission key — `delivery:manage` already existed in Phase 1's
  forward-looking catalog and is reused for both the staff-facing board (branch-nested routes)
  and the driver-facing `/mine` route. Added to STAFF's default grants (previously only
  MANAGER/DRIVER/OWNER/ADMINISTRATOR had it) — someone has to dispatch a ready delivery to a
  driver, same reasoning already applied to `order:manage`.
- API routes: `/api/branches/[id]/delivery-zones` (+ `/[zoneId]`), `/api/branches/[id]/drivers`
  (+ `/[driverId]`, `/eligible-users`), `/api/branches/[id]/deliveries` (+ `/[deliveryId]`,
  `/assign`, `/status`, `/status-history`), and the top-level `/api/deliveries/mine`.
  `drivers/eligible-users` is deliberately narrow — DRIVER-role users without a profile yet, just
  enough to populate a picker — **not** a general user-directory endpoint (`user:view`'s real
  implementation is still Phase 1's unimplemented placeholder).
- Dashboard UI: a staff-facing Delivery board (`/dashboard/delivery` — zones, driver profiles,
  and a dispatch queue with assign/status actions) and a driver-facing My Deliveries page
  (`/dashboard/my-deliveries` — only the calling driver's own assigned/history deliveries, a
  payment-status readout computed from `order.payments`, and a plain
  `https://maps.google.com/?q=<address>` link — not an integrated routing feature, just a deep
  link, since no maps/geocoding API is configured). Overview page gained a live "Active
  Deliveries" card.
- **No fake integrations, again:** delivery zones are plain staff-defined named areas, not
  geofenced (no maps API configured); proof of delivery is a staff/driver-entered text note plus
  optional recipient name, not a photo (no object storage configured) — both called out explicitly
  in code comments rather than half-built.
- Seed data extended: three delivery zones across both branches, one `Driver` profile linked to
  the existing `driver@restaurant-platform.local` demo user, and Phase 4's existing
  'delivery-preparing' seed order retrofitted with a real zone/fee (bumping its total from
  308.00 to 358.00) plus a full `DeliveryOrder`/`DeliveryStatusHistory`/`DriverAssignment` trail
  showing it as dispatched (`ASSIGNED`). The order-total backfill is guarded on `deliveryFee`
  still being `0` so re-running `prisma db seed` stays idempotent rather than re-adding the fee
  on every run.
- Unit tests: every `lib/validation/delivery.ts` schema (zone/driver/assign/status-update/list
  query — defaults, required fields, enum whitelists, malformed money). Integration tests:
  `DeliveryZoneService`/`DriverService` CRUD + tenant isolation + duplicate-name/duplicate-profile
  rejection; `DeliveryOrder` auto-creation on `OrderService.createOrder` with an **exact Decimal
  assertion** that the zone fee flows into `Order.total` (150.00 subtotal + 18.00 VAT + 50.00
  delivery fee = 218.00, mirroring the migration smoke test's worked example); driver
  assign/reassign leaving exactly one open `DriverAssignment`; the full status whitelist
  (legal/illegal transitions, `note`-required-for-CANCELLED/FAILED, `driverId`-required-for-
  PICKED_UP); and `myDeliveries` returning only the calling driver's own deliveries, including
  across organizations.

**Phase 7 — Catering: done.**
- Prisma schema additions: `CateringPackage`, `CateringInquiry`, `CateringQuote` (+
  `CateringQuoteItem`), `CateringEvent` (+ `CateringEventItem`), `CateringPayment`, plus
  `CateringInquiryStatus`, `CateringQuoteStatus`, `CateringEventStatus`, `CateringPaymentType`
  enums. See the "Phase 7 — Catering" comment block in `schema.prisma` for the five numbered
  design decisions in full; the short version: only the food portion of a quote gets real
  itemized `CateringQuoteItem` rows (staffing/equipment/transportation/setup/service-fee stay
  flat server-computed `Decimal` columns — there's no staffing-rate-card or equipment-rental
  system yet to itemize against, and this matches real catering-industry quoting practice);
  `CateringEvent` is a 1:1 companion to `CateringQuote` (`@unique quoteId`), auto-created inside
  the quote's `ACCEPTED` transition per master spec §22's literal "When accepted, create the
  appropriate catering event" instruction — the same pattern as Phase 6's `Order`→`DeliveryOrder`
  split; `CateringPayment` is a real table (unlike Phase 3's single-deposit-field `Reservation`)
  because the catering funnel needs multiple payments over time (deposit, then balance), reusing
  `OrderPaymentMethod`/`OrderPaymentStatus` rather than duplicating those enums.
- `CateringService` (per master spec §44's literal naming) implements the funnel from §21/§22:
  Inquiry → Quote → Accept → Deposit → Event → Final payment. `updateQuoteStatus` enforces a
  whitelisted `CateringQuoteStatus` state machine (`DRAFT→SENT→VIEWED→ACCEPTED`, with
  `REJECTED`/`EXPIRED`/`CANCELLED` branches requiring a reason) and special-cases `ACCEPTED`
  inside its transaction to create the `CateringEvent` (+ copy quote items into
  `CateringEventItem`) and bump the parent `CateringInquiry` to `CONVERTED`. `computeQuoteTotals`
  implements the master spec's exact formula: Food + Staffing + Equipment + Transportation +
  Setup + Service Fees − Discounts + Taxes = TOTAL (a local `PROVISIONAL_VAT_RATE`, same
  PH-tax-needs-accountant-sign-off caveat as every other tax-touching service in this codebase).
  `recordPayment`/`paymentSummary` on events mirror `OrderService`'s payment-ledger pattern
  exactly (`paidAmount`, `balanceDue`, `isFullyPaid` computed from COMPLETED/REFUNDED rows, never
  a stored running total).
- Permissions: no new permission key needed — `catering:manage` already existed in Phase 1's
  forward-looking catalog, already granted to MANAGER/OWNER/ADMINISTRATOR only (a deliberate
  difference from `order:manage`/`delivery:manage`, which STAFF also holds — catering quoting and
  event management is treated as a manager-level function, not a front-line one).
- API routes under `/api/branches/[id]/catering/packages` (+ `/[packageId]`),
  `/catering/inquiries` (+ `/[inquiryId]`, `/[inquiryId]/cancel`), `/catering/quotes` (+
  `/[quoteId]`, `/[quoteId]/status`), and `/catering/events` (+ `/[eventId]`,
  `/[eventId]/status`, `/[eventId]/payments`).
- Dashboard UI: a Catering board (`/dashboard/catering` — branch selector, package management,
  a new-inquiry form, an inquiries list with an inline quote builder — guest count, six flat fee
  inputs, a dynamic food-items list — a quotes list with status-driven action buttons and a full
  fee-breakdown display, and an events list with status actions and a payment-recording form
  showing live paid/balance totals) replacing the Phase 1 placeholder. Overview page gained a
  live "Upcoming Catering Events" card.
- Scope boundary, stated plainly: no real e-signature or PDF quote generation, and no
  customer-facing self-service portal — quote status transitions (Send/Mark viewed/Accept/
  Reject/Cancel) are staff-recorded on behalf of the customer, not driven by an actual
  customer-facing UI. Consistent with every prior phase's "no fake integrations" rule: this is
  named as a gap in the code and here, not silently faked.
- Seed data extended: 2 catering packages (Silver/Gold), and 3 inquiries spanning the funnel —
  one `NEW` with no quote, one `QUOTED` with a `SENT` quote (30 guests × Silver, hand-computed
  total `21840.00`), and one `CONVERTED` with an `ACCEPTED` quote, a `SCHEDULED` event, and a
  completed deposit payment (100 guests × Gold, hand-computed total `100800.00`).
- Unit tests: every `lib/validation/catering.ts` schema (package/inquiry/quote create+update,
  quote/event status enums, payment defaults, list-query schemas). Integration tests: package
  CRUD + duplicate-name/tenant isolation; inquiry creation, cancellation, and the
  edit-blocked-once-QUOTED rule; quote total computation with an **exact Decimal assertion**
  against the same worked example as the seed data (`foodTotal 15000.00`, `taxTotal 2340.00`,
  `total 21840.00`); rejecting a quote for a CONVERTED/CANCELLED inquiry; editing a DRAFT quote
  recomputing totals and rejecting edits once not DRAFT; the full `DRAFT→SENT→VIEWED→ACCEPTED`
  walk asserting the event auto-creation and inquiry `CONVERTED` bump; illegal-transition and
  missing-reason rejection; event status lifecycle (`SCHEDULED→IN_PROGRESS→COMPLETED`), illegal
  transitions, missing-cancellation-reason; deposit + balance payment recording with an exact
  `paymentSummary` assertion (`560.00` total, `200.00` deposit, `360.00` balance, `isFullyPaid`
  true after both); tenant isolation across packages, inquiries, quotes, events, and payments.

**Phase 8 — CRM: done.**
- Prisma schema additions: `Customer` (+ `CustomerAddress`, `CustomerPreference`, `CustomerNote`,
  `CustomerTag`, `CustomerReview`), plus a `CustomerStatus` enum and nullable `customerId` FKs on
  `Order`/`Reservation`/`CateringInquiry`/`CateringEvent`. See the "Phase 8 — CRM" comment block in
  `schema.prisma` for the five numbered design decisions in full; the short version: `Customer` is
  a new organization-scoped CRM profile, deliberately separate from `User` (same "role/account
  grants capability, profile carries domain data" split Phase 6 used for `Driver` vs. the DRIVER
  role) — `Customer.userId` is nullable and `@unique` for the minority who register, since most
  customers (walk-ins, guest orders) never will; the `customerId` link on Order/Reservation/
  CateringInquiry is client-settable and explicitly **not** auto-matched from guest name/email/
  phone (fuzzy matching has real false-positive risk, not built) — staff attach a `Customer`
  explicitly via the CRM UI; `CateringEvent.customerId` is the one exception, copied automatically
  from the accepted quote's inquiry rather than client-settable, mirroring how the event itself is
  auto-created; the relation field is named `crmCustomer` everywhere (not `customer`) to stay
  visually distinct from each model's pre-existing `customer`/`customerUserId` field (the login-
  account relation — an unrelated "was there an account" concept); `CustomerReview.rating` is
  enforced 1–5 via a hand-written migration `CHECK` constraint (Prisma DSL has no CHECK support —
  same gap as Phase 3's `EXCLUDE` constraint and Phase 4's partial unique index) plus a Zod-layer
  bound, and every review is staff-recorded (`recordedByUserId`) — there is no customer-facing
  review form.
- `lib/crm/rfm.ts` implements master spec §32's RFM segmentation as a pure, DB-free function
  (`classifySegment`) over metrics `CustomerService.getAnalytics` gathers — one fixed-precedence
  decision chain, first match wins: `HIGH_VALUE` (spend alone, checked first so one huge purchase
  isn't masked by "this is their first") → `NEW` (≤1 transaction) → `INACTIVE` → `AT_RISK` → `VIP`
  (frequency AND spend) → `REGULAR` → `RETURNING` (default). The segment is **computed live on
  every read, never stored** — this build has no background job scheduler (the same honest gap as
  Phase 5's KDS polling), so a stored `segment` column would silently go stale. Thresholds are
  configurable per master spec §32's literal instruction, via a nullable `Organization.crmSettings`
  Json column (same "JSON column, code supplies default when null" pattern as `Branch.openingHours`
  from Phase 1) — `resolveRfmThresholds` merges overrides over `DEFAULT_RFM_THRESHOLDS` field by
  field, silently falling back to that field's default on a malformed or missing override.
- `CustomerService` implements profile CRUD, addresses (with single-default exclusivity), key/value
  preferences (upsert by `[customerId, key]`), notes, tags (duplicate rejected), reviews, and
  `getAnalytics` — master spec §31's tracked metrics (total orders/reservations/catering orders,
  total spending, average order value, first/last transaction, top-5 favorite products via
  `orderItem.groupBy`, visit frequency) plus the RFM segment, all computed from real
  `Order`/`Reservation`/`CateringEvent` rows with cancelled records excluded from spend/frequency.
  `segmentBreakdown` (org-wide segment counts for the dashboard) runs `getAnalytics` once per
  customer — an honestly-flagged N+1 pattern, fine at this build's demo/early-stage data volumes,
  not something a real production deployment with thousands of customers should keep as-is.
- Permissions: `customer:manage` added to the RBAC catalog (`customer:view` already existed in
  Phase 1's forward-looking catalog) and granted to STAFF (routine front-of-house data entry when
  taking phone/walk-in orders, unlike catering which stays manager-only) and MANAGER.
- API routes under `/api/customers` (+ `/[customerId]`, `/[customerId]/analytics`, `/segments`,
  `/[customerId]/addresses` (+ `/[addressId]`), `/[customerId]/preferences` (+ `/[key]`),
  `/[customerId]/notes`, `/[customerId]/tags` (+ `/[tag]`)), plus a top-level `/api/customer-reviews`
  (not nested under a specific customer, since a review can stand alone).
- Dashboard UI: a CRM board (`/dashboard/customers` — org-scoped, no branch selector needed) with a
  segment-breakdown summary, a new-customer form, a searchable/status-filterable customer list, and
  a per-customer expandable profile panel (analytics stat tiles, favorite products, addresses,
  preferences, tags, notes, reviews — all editable inline). Overview page gained a live "Customers"
  card.
- Seed data extended: Grace Villanueva (linked to the `customer` demo user, 2 backdated real orders
  totalling exactly `873.60`, plus an address/preference/tag/note/review — the RETURNING case under
  default thresholds), Marco dela Peña (guest-only, zero transactions — the NEW case), and Patricia
  Cruz (retroactively linked onto her pre-existing Phase 7 catering inquiry/event, demonstrating
  explicit linking even onto prior history — her single `100800.00` catering event makes her
  `HIGH_VALUE`).
- Unit tests: every `lib/validation/crm.ts` schema, and `lib/crm/rfm.ts`'s `classifySegment`
  (every precedence branch, including a named regression test for a real bug caught during this
  phase — see below) and `resolveRfmThresholds` (defaults, valid overrides, malformed/negative
  overrides falling back). Integration tests: `CustomerService` CRUD (customer/address/preference/
  note/tag/review) + tenant isolation; `getAnalytics` against real `OrderService.createOrder` calls
  with **exact Decimal assertions** (two real orders totalling `940.80`, average `470.40`, a third
  CANCELLED order excluded, favorite products ordered by real summed quantity); `segmentBreakdown`;
  the automatic `customerId` copy from inquiry to `CateringEvent` at quote acceptance (walked
  through the full `DRAFT→SENT→ACCEPTED` transition, asserting the resulting `HIGH_VALUE`
  classification); and cross-org `customerId` rejection in `OrderService.createOrder`,
  `ReservationService.createReservation`, and `CateringService.createInquiry`.
- **A real bug caught during this phase, before it shipped:** the original `classifySegment`
  checked `frequency <= 1 → NEW` *before* the `HIGH_VALUE` check, so a customer's very first
  transaction — even a massive one, like a single catering event worth ₱100,800 — would always
  read as NEW, contradicting `lib/crm/rfm.ts`'s own documented design intent ("a single very large
  transaction... e.g. one very large catering event" is `HIGH_VALUE`'s own stated example). Caught
  while designing the Patricia Cruz seed data and cross-checking it against the algorithm; fixed by
  reordering the precedence chain (`HIGH_VALUE` now checked first) and covered with an explicit
  regression test (`tests/unit/crm/rfm.test.ts`, "classifies a single very large transaction as
  HIGH_VALUE, not NEW") plus the integration-level walk-through above.

**Phase 9 — Inventory: done.**
- Prisma schema additions: two scoping tiers, matching the established `MenuItem` (org-scoped
  catalog) vs. `RestaurantTable` (branch-scoped operational) split from Phase 2. Catalog tier
  (org-scoped — same definitions apply everywhere): `Unit`, `Ingredient`, `Recipe`, `RecipeItem`.
  Operational tier (branch-scoped — actual stock is a per-location fact): `InventoryItem`,
  `InventoryTransaction`, `Supplier` (org-scoped, since one supplier serves the whole business),
  `PurchaseOrder`, `PurchaseOrderItem`, `StockCount`, `StockCountItem`, `WasteRecord`; plus
  `InventoryTransactionType`, `PurchaseOrderStatus`, and `StockCountStatus` enums. See the
  "Phase 9 — Inventory" comment block in `schema.prisma` for the six numbered design decisions in
  full; the short version below.
- `lib/inventory/units.ts` implements a deliberately-scoped single-level unit conversion chain
  (`convertQuantity`, `assertSingleLevelChain`) as a pure, DB-free function — same "the algorithm
  is testable in isolation" discipline as `lib/crm/rfm.ts`. A "base" unit has `baseUnitId = null`;
  a "derived" unit points at exactly one base unit with a `conversionFactor` (e.g.
  `Gram.conversionFactor = 1000`, `Gram.baseUnitId = Kilogram.id`). Depth is capped at 1 — a
  derived unit's own base must itself be a base unit — enforced here and in `InventoryService`,
  not the database; converting between units that don't share a root base (grams to milliliters,
  say) throws, since nothing in this schema records ingredient density.
- `InventoryService` is the only code path that ever writes `quantityOnHand`, via a private
  `applyTransaction` helper using Prisma's atomic `increment` operator (race-safe by construction,
  no read-then-write) that always creates a matching `InventoryTransaction` row in the same DB
  transaction — "never silently alter inventory quantities... every adjustment must have an audit
  trail" (master spec §14) is true at the transaction level, not just by convention. All seven
  spec'd transaction types are real, reachable code paths: `PURCHASE` (PO receiving),
  `SALE_CONSUMPTION` (recipe-based, on order completion), `WASTE` (`recordWaste`),
  `ADJUSTMENT`/`RETURN` (`recordAdjustment`, signed manual correction), `TRANSFER`
  (`transferStock`, two linked transactions across branches), `COUNT_CORRECTION` (stock count
  completion). `quantityOnHand` is allowed to go negative for consumption/waste/adjustment
  (something that already physically happened must never be blocked by the ledger) —
  **except `transferStock`, which uniquely checks sufficient source stock and refuses if there
  isn't enough**, since a transfer is a deliberate two-sided action staff is choosing to take
  right now, not a fact about the past. This asymmetry is deliberate and documented in code, not
  an oversight.
- Recipe-based consumption is wired into `OrderService.updateStatus`'s existing transaction,
  triggered only on the `COMPLETED` transition (the one terminal, never-reversed state) — not at
  order creation — via `InventoryService.consumeForOrder(tx, ...)`, which accepts the already-open
  Prisma transaction client rather than opening its own (the same "one business event, one
  transaction" discipline as Phase 6's Order→DeliveryOrder and Phase 7's
  CateringQuote→CateringEvent side effects). Deliberately best-effort: an order item whose menu
  item has no recipe, a recipe ingredient with no `InventoryItem` at that branch, or an
  incompatible recipe-unit/stock-unit conversion are all silently skipped rather than thrown —
  completing a food order must never be blocked by an inventory catalog/config gap.
  `InventoryService.getCogsForOrder` sums the real ingredient cost of an order's
  `SALE_CONSUMPTION` rows — this phase's slice of master spec §37's "ingredient consumption ->
  COGS increases" (the full double-entry journal-entry side of §37 is Phase 10's job).
  `PurchaseOrder` receiving derives `costPerStockUnit` from the receipt's own numbers
  (`(receivedQty × unitCost) / convertedQtyInStockUnit`, avoiding compounded conversion rounding)
  and updates `Ingredient.costPerUnit` on every receipt — "last purchase cost wins."
- A subtle correctness decision worth calling out: `completeStockCount`'s `COUNT_CORRECTION`
  transaction is based on the **current** `quantityOnHand` at completion time, not the open-time
  `expectedQuantity` snapshot taken when the count started. `expectedQuantity` stays on the row
  purely for variance *reporting* (how much drifted since the count opened); the actual correction
  must reflect reality at completion time so any transactions that happened during the counting
  window (a sale, a delivery) aren't silently erased by a stale snapshot-based delta. Covered by an
  explicit integration test that simulates exactly this — an adjustment fired between count-open
  and count-complete — asserting the correction uses the post-adjustment balance, not the snapshot.
- Permissions: no new grant needed — `inventory:manage` already existed in Phase 1's
  forward-looking catalog, already MANAGER-only (not STAFF), mirroring `catering:manage`'s
  precedent (inventory/purchasing treated as a back-of-house/management function). All 24 new API
  routes gate on this single permission (no separate `inventory:view`).
- API routes: org-scoped catalog under `/api/units` (+ `/[unitId]`), `/api/ingredients` (+
  `/[ingredientId]`), `/api/recipes` (+ `/[recipeId]`, `/by-menu-item/[menuItemId]`),
  `/api/suppliers` (+ `/[supplierId]`); branch-scoped operational under
  `/api/branches/[id]/inventory/...` — `items` (+ `/[itemId]`, `/adjustments`, `/waste`),
  `low-stock`, `transfers`, `purchase-orders` (+ `/[poId]`, `/submit`, `/receive`, `/cancel`),
  `stock-counts` (+ `/[countId]`, `/complete`, `/cancel`), `cogs`.
- Dashboard UI: an Inventory board (`/dashboard/inventory`) with a branch selector and four
  sections — Stock (current levels with inline adjustment/waste/transfer forms), Catalog (units,
  ingredients, recipe builder per menu item), Purchasing (suppliers, PO builder, submit/receive
  per-line/cancel actions), Counts (open/complete stock counts). Overview page gained a live
  "Inventory Alerts" card (`InventoryService.getLowStockCount`, org-wide across branches — Prisma
  has no column-to-column comparison for `quantityOnHand <= reorderPoint`, so this filters in
  application code).
- Seed data extended: 5 units (kg/g, L/ml, pc), 4 ingredients (Chicken, Rice, Inasal Marinade,
  Disposable Cup), 2 recipes (Chicken Inasal Meal, Iced Tea) linked to existing menu items, 4
  branch-A stock lines (Disposable Cup deliberately seeded below its reorder point so the
  dashboard's low-stock card has a real item to show), one supplier with a fully-received purchase
  order (demonstrating `PURCHASE` + last-purchase-cost-wins), one `WASTE` record, and one completed
  `StockCount` with a real variance correction.
- Unit tests: `lib/inventory/units.ts`'s `convertQuantity` (same-unit passthrough, base↔derived
  conversion both directions, incompatible-unit rejection, zero-quantity, number/Decimal/string
  inputs) and `assertSingleLevelChain` (valid depth-1 chain accepted, depth-2 chain rejected); every
  `lib/validation/inventory.ts` schema. Integration tests (`InventoryService`): Unit/Ingredient/
  Recipe CRUD + tenant isolation + duplicate-ingredient-in-recipe rejection; `InventoryItem`
  creation's guaranteed initial `ADJUSTMENT` transaction (including a zero-quantity starting
  balance); `recordAdjustment`/`recordWaste` with exact-Decimal running-balance assertions,
  including going negative; `transferStock` (success, insufficient-stock rejection, same-branch
  rejection); Supplier CRUD; the full `PurchaseOrder` lifecycle (create DRAFT → submit → partially
  receive → fully receive) with exact `lineTotal`/`total` math, a receipt ordered in a unit
  different from the ingredient's stock unit (grams ordered, kilograms stocked) proving the
  conversion and derived cost-per-stock-unit are exact, and "last purchase cost wins"; `StockCount`
  lifecycle including the current-balance-not-stale-snapshot correction test described above and a
  partial-count-stays-OPEN case; `consumeForOrder`/`getCogsForOrder` exercised through a real
  `OrderService.createOrder` + four `updateStatus` calls to `COMPLETED`, asserting exact
  unit-converted ingredient consumption and COGS, plus the two silent-skip cases (no recipe, no
  `InventoryItem` at that branch); `getLowStockItems`/`getLowStockCount` threshold classification.

**Phase 10 — Accounting: done.**
- Prisma schema additions: `ChartOfAccount` (org-scoped, seeded per-org), `AccountingPeriod`
  (calendar-month buckets, lazily created), `JournalEntry`/`JournalEntryLine`
  (`DRAFT -> POSTED -> REVERSED`, a DB `CHECK` enforcing exactly-one-of-debit-or-credit per line),
  `FinancialTransaction` (the `(referenceType, referenceId, type)`-unique idempotency/link layer
  master spec §47 asks for), `Vendor`/`ExpenseCategory`/`Expense`/`ExpenseAttachment`; plus
  `AccountType`, `DebitCredit`, `AccountingPeriodStatus`, `JournalEntryStatus`,
  `FinancialTransactionType`, `ExpenseApprovalStatus` enums. See the "Phase 10 — Accounting"
  comment block in `schema.prisma` for the ten numbered design decisions in full; the short
  version below.
- `AccountingService.ensureChartOfAccounts` seeds the master-spec-§28 30-account chart
  (idempotent — check-then-create) and is called from two places: `AuthService.register`'s
  existing transaction (every organization created from Phase 10 onward gets it automatically,
  the same "provision everything a brand-new org needs, in one transaction" discipline as
  role/permission seeding), and by hand in `prisma/seed.ts` for the demo org, which predates this
  phase and was only ever `upsert`'d, never freshly `create`'d through `AuthService.register`.
- A posted `JournalEntry` is never edited — no service method touches a `POSTED` entry's lines;
  the only correction path is `reverseJournalEntry`, which creates a brand-new `POSTED` entry with
  every line's debit/credit swapped (referencing the original via `reversalOfEntryId`, `@unique`
  so an entry can only ever be reversed once) and flips the original to `REVERSED` — a lifecycle
  marker, not a content edit. Master spec §27: "do not allow a posted journal entry to be directly
  edited... use reversal/correction entries."
- The financial transaction engine (`AccountingService`'s `record*` methods) is the single place
  every real business event becomes ledger postings, called from inside each triggering service's
  own already-open transaction (the established "one business event, one transaction" discipline):
  `OrderService.updateStatus`'s `COMPLETED` transition posts revenue (Cash/Accounts-Receivable
  split by how much of the order is actually paid so far, Credit the order-type-matched revenue
  account, Credit Taxes Payable) and COGS (Debit Food Cost, Credit Inventory, using the exact
  consumption cost `InventoryService.consumeForOrder` now returns — its signature changed from
  `Promise<void>` to `Promise<Prisma.Decimal>` this phase) as two **independent** entries — an
  order with ingredients consumed but zero net revenue still posts COGS, and vice versa.
  `ReservationService.recordDeposit`/`updateStatus` and `CateringService.recordPayment` post
  deposits as a liability first, never straight to revenue (master spec §23: "do not automatically
  classify customer deposits as earned revenue") — a reservation deposit is earned only when the
  reservation reaches `COMPLETED`; a catering event's revenue is recognized on its `BALANCE`
  payment, and the amount recognized is **the sum of actual payments received to date** (every
  prior `DEPOSIT` plus this `BALANCE`), never the quoted `CateringEvent.total` — a deliberate
  choice so the entry is always grounded in real recorded cash movements, honoring §29's "AI must
  never directly invent accounting entries" even if a customer ends up paying slightly more or
  less than quoted. `InventoryService.receivePurchaseOrderItems` posts Debit Inventory / Credit
  Accounts Payable (idempotency keyed to the **receiving call's own `InventoryTransaction` id**,
  not the `PurchaseOrder` id — a PO can legitimately be received against multiple times via
  partial receiving, and a PO-level key would silently block every receipt after the first from
  ever posting); `InventoryService.recordWaste` posts Debit Waste / Credit Inventory (a
  `WasteRecord` row is already a distinct entity per event, so it's a safe idempotency key on its
  own). Unlike Phase 9's best-effort inventory consumption, **none of these are best-effort** — a
  missing chart-of-accounts entry throws (a setup bug, not a normal per-branch data gap), since
  silently losing revenue from the books is worse than blocking the triggering business event.
- Expenses follow a create-(`PENDING`)-then-approve/reject flow. `approveExpense` posts Debit the
  category's configured default account / Credit Cash-or-Bank (by payment method) and refuses if
  the category has no default account configured, rather than guessing one — the same
  never-invent-an-entry discipline. `Vendor` (general business overhead, feeds `Expense`) is kept
  deliberately separate from Phase 9's `Supplier` (ingredients, feeds `PurchaseOrder`) despite
  structural similarity — the master spec lists them in separate sections with separate purposes.
- Balances: `getAccountBalance` (signed by the account's `normalBalance`) and
  `generateTrialBalance` (every active account's posted debit/credit totals plus the overall
  `SUM(DEBITS) = SUM(CREDITS)` check master spec §49 asks for — an honest N+1 across accounts,
  same flagged pattern as Phase 8's `segmentBreakdown`) are built this phase since they're needed
  to prove that invariant; the *presentational* reports (income statement, balance sheet, cash
  flow, financial dashboard UI) are Phase 11's job per its own separate build list.
- Permissions: no new grant needed — `finance:view`/`finance:manage` already existed in Phase 1's
  forward-looking catalog, already granted only to `ACCOUNTANT`/`OWNER`/`ADMINISTRATOR` —
  deliberately **not** granted to `MANAGER` (finance is accountant/owner territory, confirmed by
  reading `DEFAULT_ROLE_PERMISSIONS` before assuming a gap).
- API routes: org-scoped under `/api/finance/accounts` (+ `/[accountId]`), `/journal-entries` (+
  `/[entryId]`, `/[entryId]/post`, `/[entryId]/reverse`), `/trial-balance`, `/periods` (+
  `/[periodId]/close`), `/vendors` (+ `/[vendorId]`), `/expense-categories` (+ `/[categoryId]`);
  branch-scoped under `/api/branches/[id]/finance/expenses` (+ `/[expenseId]`,
  `/[expenseId]/approve`, `/[expenseId]/reject`, `/[expenseId]/attachments`).
- Dashboard UI: a Finance board (`/dashboard/finance`) with five sections — Chart of Accounts
  (grouped by type, activate/deactivate, add a custom account), Journal Entries (list + a manual
  entry builder with dynamic debit/credit lines and a live balance check + post/reverse actions),
  Trial Balance (as-of-date, per-account debit/credit/balance, a Balanced/Out-of-balance badge),
  Periods (list + close action), Expenses (branch-scoped list + record/approve/reject, plus
  vendor and expense-category management).
- Seed data extended: the full 30-account chart for the demo org (via `ensureChartOfAccounts`,
  hand-mirrored since this script cannot import service classes — see the environment-constraints
  note below), a posted manual journal entry (owner's initial capital contribution) and a draft
  one (petty cash top-up, demonstrating the Post/Reverse UI), 2 vendors, 3 expense categories (2
  with a default account configured, 1 deliberately without one to demonstrate
  `approveExpense`'s refusal to guess), and 3 expenses (1 approved/posted, 2 pending — one in the
  no-default-account category).
- Tests: schema validation (the debit/credit-exactly-one-side refine, min-2-lines, the
  nullable-clearable `defaultAccountId` union); `AccountingService` core mechanics (chart
  seeding + idempotency, balanced/unbalanced entry creation, post/reverse lifecycle and
  double-reversal rejection, trial balance always summing debits=credits, period-close blocking
  on outstanding drafts and on future postings once closed, vendor/category CRUD, expense
  approve/reject including the no-default-account refusal); and — per master spec §49's exact
  test list — a dedicated integration suite driving the real wiring (not `AccountingService`
  directly) through `OrderService`/`ReservationService`/`CateringService`/`InventoryService`:
  balanced revenue + COGS entries on order completion (both fully-paid and partially-paid/AR
  cases), reservation deposit paid/refunded/earned, catering deposit-received and
  balance-settlement-uses-actual-payments, PO receiving (including that partial receiving posts
  a separate entry each time, proving the idempotency key choice), waste, a mixed-event scenario
  proving the trial balance stays balanced end-to-end, and — §49's explicit final instruction —
  a test proving that **deleting an order does not corrupt its accounting history** (the journal
  entry/lines have no FK back to `Order` at all, only the loose `referenceType`/`referenceId`
  string link).
- **Master spec §68 accounting disclaimer, flagged explicitly and not silently assumed**: this
  architecture is technically sound (balanced double-entry, immutable posted entries, idempotent
  automatic postings) but does **not** assume Philippine tax/accounting compliance automatically.
  Before this ledger is used for real filings, a Philippine accountant/tax professional should
  verify: VAT/tax treatment (this build applies a flat 12% VAT to order/catering totals and
  credits it to "Taxes Payable" — no BIR-specific input/output VAT netting, zero-rating, or
  official-receipt sequencing is implemented), official invoicing requirements (Phase 4's
  `Invoice`/`InvoiceSequence` numbering is a per-branch sequence, not necessarily BIR's
  accreditation format), revenue recognition timing (this build's deposit-earned-on-completion
  and balance-settlement-recognizes-actual-payments rules are reasonable defaults, not
  professionally reviewed policy), payroll (not built at all — `Payroll` is only a seeded expense
  account name, no payroll engine exists), withholding tax (not implemented anywhere), and data
  privacy (no Philippine Data Privacy Act-specific review has been done on any phase's PII
  handling).

**Phase 11 — Financial Reporting: done.**

- Master spec §35: "Reports must be generated from the accounting ledger. Do not calculate
  financial statements from UI aggregates." `services/reporting/ReportingService.ts` is entirely
  read-only and queries only posted `JournalEntry`/`JournalEntryLine` rows (joined to
  `ChartOfAccount`) — nothing in it reads `Order`, `Reservation`, `CateringPayment`, or any other
  business-event table. Trial balance and single-account balances (`AccountingService`) were
  already built in Phase 10 and are reused as-is, per that phase's own scope call, now validated
  by the master spec's own Phase 11 build list naming them alongside the reports below.
- `generateIncomeStatement(organizationId, {startDate, endDate, branchId?})`: Revenue − COGS =
  Gross Profit; − Operating Expenses = Net Profit, aggregated per account (signed by the account's
  own `normalBalance`, so callers never re-sign a raw debit/credit total themselves) over posted
  lines in the given range. `DRAFT`/`REVERSED` entries are excluded, same convention as
  `AccountingService.getAccountBalance`.
- `generateBalanceSheet(organizationId, {asOfDate, branchId?})`: Assets / Liabilities / Equity as
  of a point in time. There is no period-closing journal entry in this build (Phase 10's
  `AccountingPeriod.close` only blocks further postings into a closed period — it never zeroes
  Revenue/COGS/Expense balances into Retained Earnings), so Revenue/COGS/Expense balances
  accumulate on the ledger forever. The Balance Sheet folds the still-unclosed cumulative net
  income (Revenue − COGS − Expense, from inception through `asOfDate`) into Equity — this is
  exactly what any live system without a year-end close does, and it makes
  `Assets = Liabilities + Equity` a genuine double-entry guarantee rather than an approximation:
  every posted entry individually balances, so the identity holds for *any* subset of whole
  entries, including a single branch's — proven for an arbitrary transaction mix in
  `tests/integration/reporting/reporting-service.test.ts`.
- `generateCashFlow(organizationId, {startDate, endDate, branchId?})`: Operating / Investing /
  Financing / Net Cash Flow, direct method. Master spec §35 gives only the generic textbook
  categories with no restaurant-specific mapping, so this phase adds two columns to
  `ChartOfAccount` — `isCashEquivalent` (true only for the seeded Cash/Bank accounts) and
  `cashFlowCategory` (nullable `OPERATING`/`INVESTING`/`FINANCING`, classifying every other
  account) — rather than guessing the classification from account name/type at report time. The
  method walks every posted entry that touches a cash-equivalent account and attributes its exact
  net cash impact to whichever category the *other* (non-cash) line(s) belong to. This is exact,
  not a heuristic: every posted entry balances (enforced at posting time by
  `AccountingService.assertBalanced`), so `sum(non-cash lines' credit − debit)` is identically
  equal to that entry's net cash inflow/outflow — no proportional guessing, no double-counting. A
  non-cash line whose account has no `cashFlowCategory` set (a custom account an org added without
  classifying it) lands in a reported `unclassifiedActivities` bucket rather than being silently
  dropped. A journal entry that moves money between two cash-equivalent accounts (e.g. a
  register-to-bank deposit) nets to zero across every category, correctly reflecting that total
  cash-on-hand didn't change. Reconciliation (master spec Phase 11's explicit "Verify
  reconciliation" instruction): `netCashFlow` is asserted, in both the integration test suite and
  a hand-written SQL smoke test, to equal `endingCash − beginningCash` computed independently —
  see the Known Issues entry below for the smoke test's numbers.
- `getFinancialDashboard(organizationId, {branchId?})`: master spec §33/§53's financial figures —
  Today's Revenue, Today's Expenses, Gross Profit, Net Profit, Cash Position, Outstanding
  Receivables, Outstanding Payables, Inventory Value. §53's own example numbers only reconcile as
  Revenue − Expenses = Gross Profit (125,450 − 63,200 = 62,250), i.e. "Expenses" there is COGS
  specifically, with Operating Expenses folded into Net Profit rather than shown as its own card —
  `todayExpenses` mirrors that (`todayOperatingExpenses` is exposed separately for the full
  breakdown). "Today" is resolved in the organization's own timezone (`lib/utils/timezone.ts`,
  master spec §54's date-range presets — today/yesterday/this week/last week/this month/last
  month/this quarter/this year/custom — same `Intl.DateTimeFormat`-against-an-IANA-zone approach
  as `ReservationService`'s existing business-hours check, no date library). Outstanding
  Receivables/Payables/Inventory Value are read by exact account name ("Accounts Receivable" /
  "Accounts Payable" / "Inventory") — the same not-best-effort, assumes-the-seeded-chart's-names
  convention `AccountingService`'s automatic-posting methods already use throughout Phase 10; Cash
  Position is flag-driven (`isCashEquivalent`), not name-driven, so a second cash-equivalent
  account an org adds later stays correctly included. Master spec §36: "use caching carefully so
  financial information does not become misleadingly stale... for financial data, correctness is
  more important than aggressive caching" — honored by simply never caching; every report is
  computed live on each request.
- Scope boundary vs. Phase 12 (Owner Analytics), confirmed by reading both phases' own build
  lists: §34 Sales Analytics (revenue-over-time and by-channel/product/category/branch/hour/day/
  month charts) and the *operational* counts on §33's Owner Dashboard list (Orders, Reservations,
  Customers, Catering Events) belong to Phase 12, not this phase — this phase's dashboard sticks
  to the financial figures only.
- API routes (all read-only, gated on `FINANCE_VIEW` — no new permission needed, same reuse
  precedent as Phase 10's own routes): `/api/finance/reports/income-statement`,
  `/balance-sheet`, `/cash-flow`, `/dashboard`.
- Dashboard UI: a new "Reports" section in the Finance board (now the board's default landing
  section, ahead of Chart of Accounts — matching §53's "the first screen should communicate
  business health immediately") with four tabs (Dashboard, Income Statement, Balance Sheet, Cash
  Flow), a branch filter, and §54's date-range preset selector (with a custom-range picker) or an
  as-of-date picker where the report calls for a point in time instead of a range.
- No seed data changes beyond mirroring the two new `ChartOfAccount` columns in
  `prisma/seed.ts`'s hand-written chart-of-accounts array — this phase is pure read/aggregation
  over Phase 10's already-seeded ledger, so the existing demo data already exercises every report.
- Tests: `lib/utils/timezone.ts`'s date-range presets (verified against hand-computed Asia/Manila
  boundaries for every preset, including week/month/quarter/year edges) and
  `lib/validation/reporting.ts`'s schemas at the unit level; at the integration level, Income
  Statement math against known postings (plus date-range and branch scoping), Balance Sheet's
  `Assets = Liabilities + Equity + NetIncomeToDate` invariant (including that a `DRAFT` entry
  doesn't perturb it, and that a branch-scoped balance sheet also balances), Cash Flow's category
  attribution and its `netCashFlow = endingCash − beginningCash` reconciliation (including the
  unclassified bucket and the cash-to-cash-transfer-nets-to-zero case), and the dashboard's
  today-figures and branch scoping.

**Not yet built** (Phases 12–16 per `docs/architecture.md`): owner analytics, AI insights,
notifications, hardening, deployment.

## Known Issues / Environment Constraints

- **Login requires an "organization email" alongside the user's own email.** Because `User.email`
  is unique per-organization (not globally — the same person may be a customer of two different
  restaurant organizations on the platform), a login request must disambiguate which organization
  to check credentials against. Phase 1 does this by asking for the organization's own (globally
  unique) contact email. This is functional but not great UX; a friendlier flow (org
  slug/subdomain, or "look up my organizations by email") is still unaddressed — not part of
  Phase 2's scope, revisit in a later phase.

- **This build environment has no outbound network access to package registries** (npm, pip —
  all return 403). `npm install` could not be run here, so dependencies are declared in
  `package.json` but `node_modules` does not exist yet, and the Next.js app itself has not been
  started, built, or had its test suite executed in this sandbox. Run
  `npm install && npx prisma migrate dev && npm test` in an environment with network access before
  trusting this as working software.
  What *was* verified in this sandbox, despite the constraint:
  - Every `.ts`/`.tsx` file was type-checked with the TypeScript compiler (pre-installed locally,
    no npm needed) using `--noResolve`-equivalent flags. All ~180 reported errors were confirmed
    to be `Cannot find module` (expected — no `node_modules`) or a same-shaped `instanceof`
    narrowing artifact caused by those missing types; one genuine type issue
    (`services/auth/AuthService.ts`, the `roles` array typing) was found this way and fixed.
  - `prisma/migrations/20260814020318_init/migration.sql` was hand-written to match
    `schema.prisma` exactly (Prisma CLI itself needs `node_modules`) and applied directly to a
    real local PostgreSQL 16 instance with `psql` — it ran clean.
  - A SQL smoke test then exercised the constraints the application code relies on directly
    against that database: organization email uniqueness, per-organization (not global) user
    email uniqueness, all seven `RoleName` enum values accepting/rejecting correctly, role
    uniqueness per organization, the permission/role/user_role join wiring, and cascading delete
    from `organizations` down to `users`/`roles`/etc. All passed. This is real evidence the schema
    is sound, independent of whether the Node app layer has been exercised yet.
  - A real, if unavoidable, bug was caught and fixed this way too: the original folder
    layout put staff dashboard pages under a Next.js *route group* `(dashboard)/`, which is
    pathless and would have collided with the customer-facing `(customer)/` group's routes (both
    would resolve to bare `/orders`, `/reservations`, etc.). Restructured to a real `app/dashboard/`
    path segment — see `docs/architecture.md` § 4a.
  - Phase 2 repeated the same verification approach:
    `prisma/migrations/20260814030000_phase2_tables_menu/migration.sql` was hand-written and
    applied clean to the same local Postgres instance, then an 11-assertion SQL smoke test
    verified table-number uniqueness per-branch (not global), the `TableStatus`/
    `ModifierSelectionType` enums, `table_status_history` allowing a null `fromStatus` on first
    insert, section-delete-`SET NULL`-vs-table-delete-`CASCADE` semantics, menu category delete
    being `RESTRICT`ed while items reference it, exact `DECIMAL(10,2)` price storage (no float
    drift), and modifier group/modifier/item-link wiring including duplicate-link rejection. All
    passed. The TypeScript syntax pass was re-run across all ~84 files (Phase 1 + 2) and caught
    one more instance of the same `any`-through-generic-inference quirk as the Phase 1 `roles`
    fix (this time in `prisma/seed.ts`'s `categoryByName` map) — fixed the same way, with an
    explicit type annotation instead of relying on inference.
  - Phase 3 went further than a sequential smoke test: after hand-writing and applying
    `prisma/migrations/20260814040000_phase3_reservations/migration.sql` (including
    `CREATE EXTENSION IF NOT EXISTS btree_gist;` and the `no_double_booking` EXCLUDE constraint)
    to the same local Postgres instance, a 7-assertion sequential smoke test verified the basics
    (overlap rejection, back-to-back non-overlap acceptance, cancelled rows not blocking rebooking,
    the constraint being per-table not global, exact `DECIMAL(10,2)` deposit storage, and cascade
    deletes). Then a **genuine concurrency test** ran two separate `psql` processes as real
    concurrent OS processes: session A opened a transaction, inserted a booking, and held it open
    with `pg_sleep(4)`; session B, started ~1s later, attempted an overlapping booking on the same
    table as a plain auto-commit statement. Session B's `INSERT` blocked for ~3 seconds (visibly
    waiting on session A's uncommitted row via Postgres' own locking, not a bug), then failed with
    `ERROR: conflicting key value violates exclusion constraint "no_double_booking"` the instant
    session A committed — confirmed via each session's captured log output and a final query
    showing only session A's row exists. This is a materially stronger proof than a sequential
    "call twice, expect the second to fail" test: it demonstrates the guarantee holds under an
    actual race, not just repeated single-threaded calls. The same guarantee is also exercised as
    an automated Vitest integration test
    (`tests/integration/reservations/reservation-service.test.ts`, "prevents a genuine concurrent
    double-booking...") using `Promise.allSettled` on two simultaneous service calls — authored and
    TS-syntax-checked here, not yet runtime-executed for the same `npm install` reason as every
    other test in this repo (see below).
  - Phase 4 followed the same two-layer approach. `prisma/migrations/20260814050000_phase4_orders/
    migration.sql` (including the `invoices_one_active_per_order` partial unique index) was
    hand-written and applied clean to the same local Postgres instance after a mid-session
    `pg_ctlcluster` restart (the cluster had stopped between turns; verified schema/data were
    intact before proceeding). A 7-assertion sequential smoke test then verified: exact
    `DECIMAL(10,2)` order-total round-tripping, an `ON DELETE RESTRICT` foreign key rejecting
    deletion of a menu item referenced by an order line, cascade delete removing an order's items/
    status-history/payments, the first invoice for an order issuing as `INV-000001`, a second
    `ISSUED` invoice for the same order being rejected by the partial unique index, void-then
    -reissue for the same order being accepted, and a duplicate invoice number within the same
    branch being rejected. All passed. Then, mirroring Phase 3's two-process concurrency proof but
    for a different guarantee, a genuine `Promise.allSettled` test issued invoices for 5 fully-paid
    orders on the same branch truly concurrently (not sequentially) via
    `InvoiceService.issueInvoice` and asserted all 5 succeeded with unique numbers
    `INV-000001`..`INV-000005` — real evidence the atomic-`upsert`-based sequence counter holds
    under a race, the same rigor as Phase 3's `EXCLUDE`-constraint proof applied to "safely assign
    the next number" instead of "safely reject an overlap." The TypeScript syntax pass was re-run
    across all 118 files (Phases 1-4) and caught a third occurrence of the same `any`-through
    -generic-inference quirk as the Phase 1 (`AuthService.roles`) and Phase 2 (`seed.ts`
    `categoryByName`) fixes — this time in `OrderService.resolveAndPriceItems`'s `menuItemById`
    map, where `new Map(menuItems.map(...))` inferred `unknown` values because `menuItems` flowed
    through `any` (unresolved Prisma types from the missing `node_modules`) — fixed identically
    with an explicit `new Map<string, (typeof menuItems)[number]>(...)` type argument. A real race
    condition was also caught and fixed during self-review (not by the compiler): `createOrder`
    originally read a dine-in table's status once *before* opening the `$transaction` and passed
    that stale snapshot into the auto-seat logic — the same class of TOCTOU bug Phase 3 was careful
    to avoid for reservations. Fixed by re-reading the table's status *inside* the transaction
    (`tx.restaurantTable.findUniqueOrThrow`) immediately before deciding whether to transition it.
  - Phase 5's schema change is small (one nullable column, no new tables — see the Phase 5 status
    entry above for why), so its migration verification is proportionally lighter, but still real:
    `prisma/migrations/20260814060000_phase5_kitchen_display/migration.sql` was hand-written and
    applied clean to the same local Postgres instance (again after a mid-session `pg_ctlcluster`
    restart — the cluster had stopped between turns; schema/data were verified intact first). A
    3-assertion smoke test then verified `requiredAt` round-trips exactly with no truncation/
    timezone drift, a null `requiredAt` is accepted (the "ASAP" default case), and a kitchen
    -queue-shaped query (active statuses, correct branch) returns the expected row count. All
    passed. The TypeScript syntax pass (see the compiler-version note below) confirmed Phase 5
    introduced zero new diagnostic categories beyond the ones already present in the untouched
    Phase 1-4 codebase under the same compiler version — a before/after diff, not a spot check.
  - Phase 6's migration (`prisma/migrations/20260814070000_phase6_delivery/migration.sql`) adds
    one column to `orders` and five new tables; hand-written and applied clean to both the dev and
    test local Postgres databases. A 5-assertion smoke test verified: order total correctly
    includes `deliveryFee` (228.00, exact); a duplicate `DeliveryOrder.orderId` is rejected by the
    unique constraint; deleting a referenced `DeliveryZone` is blocked (`ON DELETE RESTRICT`);
    driver reassignment leaves exactly one open `DriverAssignment` row; and cascading delete from
    `orders` removes the dependent `delivery_orders`/`delivery_status_history`/
    `driver_assignments` rows. All passed. The `git stash -u` before/after TypeScript diff (see
    below) confirmed the same result as Phase 5: zero new diagnostic categories, all growth inside
    already-established ones — including 3 new `TS2882` instances (missing type declarations for
    `import 'server-only'`), the identical pattern every other service file in this codebase
    already hits, not a new failure mode.
- Payment, email, SMS, push, storage, maps, and AI providers are all unconfigured placeholders —
  see `.env.example`. No fake integrations were built. `lib/payments/PaymentProvider.ts` (Phase 4)
  is the first of these interfaces actually written; the rest remain interface-less placeholders
  until their phase.
- **The sandbox's global TypeScript compiler advanced versions between Phase 4 and Phase 5** (now
  `6.0.3`), which changes the TS-syntax-check methodology described above in two ways worth
  recording honestly rather than silently re-tuning the numbers:
  1. `tsc --noEmit` now refuses to run at all against this repo's `tsconfig.json` (`TS5101`:
     `baseUrl` is deprecated, exits before checking a single file) unless
     `"ignoreDeprecations": "6.0"` is set. Added that key to `tsconfig.json` this phase — a real,
     forward-compatible config fix (this is literally what the compiler's own error message
     recommends), not a workaround specific to this sandbox.
  2. With that unblocked, this compiler version surfaces several new diagnostic categories this
     repo hadn't seen before — `TS7026` ("JSX element implicitly has type 'any'", because
     `@types/react`'s `JSX.IntrinsicElements` can't resolve without `node_modules`) and `TS7006`
     ("implicitly has an 'any' type", the same missing-types cascade landing on more call sites
     under this version's inference). **These are not new bugs.** Proof: running this same
     compiler against the Phase 1-4 code exactly as committed (`git stash -u`, i.e. before any
     Phase 5 file existed) already produces 1,029 diagnostics in these exact categories
     (`TS7026`: 679, `TS7006`: 190) on code that was fully hand-verified and shipped three phases
     ago. Phase 5's own changes added 72 more diagnostics on top of that baseline — all in the
     same already-established categories (new JSX in the kitchen board and page, new imports in
     new files), zero new categories. The one genuinely new diagnostic Phase 5's first draft
     introduced (`TS2322` on `components/kitchen/kitchen-board.tsx`, from extracting ticket
     rendering into a separately-typed `TicketCard` component — passing `key` to a locally
     -defined component hits the same "JSX.LibraryManagedAttributes needs @types/react"
     resolution gap) was fixed by inlining that JSX at the call site instead, matching how every
     other list in this codebase (`order-board.tsx`, `reservation-board.tsx`, etc.) already
     renders — zero net new diagnostic categories introduced by Phase 5, confirmed by an explicit
     before/after diff of the full compiler run, not just a spot check.
  Bottom line: this is a real, non-cosmetic finding about the sandbox's evolving toolchain, worth
  flagging so a future phase doesn't mistake a large error count for new breakage — it will
  disappear entirely the moment `npm install` actually runs and `@types/react`/`@types/node`/
  `@prisma/client`'s generated types exist. The `TS2307`/`TS2503`/`TS2882`/`TS2591` categories
  from Phases 1-4 are unaffected in shape, just present in the same files as before.
  Phase 6 re-ran this same `git stash -u` before/after diff (now the standard verification step
  for every phase, per Phase 5's note above): baseline (Phase 1-5 code, this compiler) was 1,101
  diagnostics (`TS7026`: 743, `TS7006`: 192, `TS2307`: 112, `TS2503`: 14, `TS2882`: 13, `TS7031`:
  12, `TS2591`: 11, `TS7053`: 2, `TS2345`: 1, `TS18046`: 1 — matching exactly the expected
  1,029 + 72 from Phase 5's own diff, a useful cross-check that the methodology itself is sound).
  After Phase 6: 1,297 diagnostics — 196 more, entirely inside `TS7026` (+138), `TS7006` (+36),
  `TS2307` (+19), and `TS2882` (+3, the three new `server-only` imports noted above). Zero new
  categories. No `TS2322` key-prop diagnostic appeared this phase — both new list renders
  (`delivery-board.tsx`, `my-deliveries.tsx`) render their `.map()` rows inline rather than
  extracting a separately-typed child component, avoiding the Phase 5 pitfall from the start.
  Phase 7's migration (`prisma/migrations/20260815040000_phase7_catering/migration.sql`) adds
  four enums and seven new tables; hand-written and applied clean to both the dev and test local
  Postgres databases (after another mid-session `pg_ctlcluster` restart — confirmed 0
  organizations afterward, expected since no real seed run happens in this sandbox). A
  7-assertion smoke test verified: a quote total round-trips exactly (`67200.00`); a duplicate
  `CateringEvent.quoteId` is rejected by the unique constraint; a deposit + balance payment sum
  to the event total exactly; deleting a quote with an existing event is blocked (`ON DELETE
  RESTRICT`); deleting an event cascades to its items/payments; deleting a quote with no event
  cascades to its items; and an undocumented `CateringQuoteStatus` value is rejected by the enum
  type. All passed. The `git stash -u` before/after TypeScript diff (checked out to the
  pre-Phase-7 commit, re-ran `tsc --noEmit`, checked back out to the tip) confirmed the same
  result as Phases 5-6: baseline was 1,298 diagnostics, after Phase 7 was 1,539 — 241 more,
  entirely inside already-established categories (`TS7026` +148, `TS7006` +74, `TS2307` +18,
  `TS2882` +1 — one new `server-only` import in `CateringService.ts`, the identical pattern every
  other service file hits). Zero new diagnostic categories. No `TS2322` key-prop diagnostic
  appeared — `catering-board.tsx`'s list renders (packages, inquiries, quotes, events) all render
  their `.map()` rows inline, same discipline as Phase 6.
  Phase 8's migration (`prisma/migrations/20260815050000_phase8_crm/migration.sql`) adds one
  JSONB column to `organizations`, four nullable `customerId` columns across
  `orders`/`reservations`/`catering_inquiries`/`catering_events`, one enum, and six new tables;
  hand-written and applied clean to both the dev and test local Postgres databases. An
  8-assertion smoke test verified: duplicate `customers.userId` rejected by the unique
  constraint; the `customer_reviews.rating` `CHECK` constraint rejects a rating of 6; a duplicate
  `(customerId, key)` preference is rejected; two orders' totals sum exactly to `896.00` for a
  customer; deleting a customer cascades to its addresses/preferences/notes/tags; deleting a
  customer `SET NULL`s `orders.customerId` and `customer_reviews.customerId` rather than blocking
  (history is preserved even once the profile is gone); `Organization.crmSettings` JSON
  round-trips; and an undocumented `CustomerStatus` value is rejected by the enum type. All
  passed. The `git stash -u` (no local changes to stash — the working tree was already committed)
  before/after TypeScript diff (checked out to the pre-Phase-8 commit `5ceb2d1`, re-ran
  `tsc --noEmit`, checked back out to the tip) confirmed the same result as every prior phase:
  baseline was 1,538 diagnostics, after Phase 8 was 1,745 — 207 more, entirely inside
  already-established categories (`TS7026` +138, `TS7006` +49, `TS2307` +19, `TS2882` +1 — one
  new `server-only` import in `CustomerService.ts`, the identical pattern every other service file
  hits). Zero new diagnostic categories. The two pre-existing non-artifact diagnostics
  (`TS2345` in `app/dashboard/layout.tsx`, `TS18046` in `lib/utils/api-error.ts`) are unchanged
  from every prior phase's count — confirmed still not something Phase 8 touched or introduced.
  No `TS2322` key-prop diagnostic appeared — `customer-board.tsx`'s list renders (customers,
  addresses, preferences, tags, notes, reviews, favorite products) all render their `.map()` rows
  inline, same discipline as Phases 6-7.
  Phase 9's migration (`prisma/migrations/20260815060000_phase9_inventory/migration.sql`) adds
  three enums and eleven new tables (`units`, `ingredients`, `recipes`, `recipe_items`,
  `inventory_items`, `inventory_transactions`, `suppliers`, `purchase_orders`,
  `purchase_order_items`, `stock_counts`, `stock_count_items`, `waste_records`); hand-written and
  applied clean to both the dev and test local Postgres databases. A 12-assertion smoke test
  verified: the kg/g unit conversion chain; a duplicate unit abbreviation per organization
  rejected; deleting a unit referenced by an ingredient blocked (`RESTRICT`); an `InventoryItem` +
  initial `ADJUSTMENT` transaction with an exact running-balance assertion after a
  `SALE_CONSUMPTION`; `quantityOnHand` allowed to go negative; a duplicate `InventoryItem` for the
  same `(branch, ingredient)` pair rejected; deleting a referenced `Ingredient` blocked; deleting
  an `InventoryItem` cascading its transaction rows; `PurchaseOrder`/`PurchaseOrderItem` exact
  arithmetic plus deleting a `Supplier` with an existing PO blocked; and an undocumented
  `InventoryTransactionType` value rejected by the enum type. All passed. This session's copy of
  `/root` has mode `700` (root-only traversal), so the `postgres` OS user cannot read migration or
  smoke-test files directly under `/root/restaurant-platform/...` via `psql -f` — every `psql -f`
  call this phase first copied the file to `/tmp` (`cp ... /tmp/x.sql && chmod 644 /tmp/x.sql`)
  before running it from there; worth knowing if a future phase hits the same "Permission denied"
  reading a file that plainly exists. The `git stash -u` before/after TypeScript diff (checked out
  to the pre-Phase-9 commit `6e67b0f`, re-ran `tsc --noEmit`, checked back out to the tip)
  confirmed the same result as every prior phase: baseline was 1,745 diagnostics, after Phase 9 was
  2,180 — 435 more, entirely inside already-established categories (`TS7026` +242, `TS7006` +157,
  `TS2307` +35, `TS2882` +1 — one new `server-only` import in `InventoryService.ts`, the identical
  pattern every other service file hits). Zero new diagnostic categories. The two pre-existing
  non-artifact diagnostics (`TS2345` in `app/dashboard/layout.tsx`, `TS18046` in
  `lib/utils/api-error.ts`) are unchanged from every prior phase's count — confirmed still not
  something Phase 9 touched or introduced. No `TS2322` key-prop diagnostic appeared —
  `inventory-board.tsx`'s list renders (stock lines, units, ingredients, recipes, suppliers,
  purchase orders, stock counts) all render their `.map()` rows inline, same discipline as Phases
  6-8. Also note: this sandbox has no `.env`/`.env.test` files by default (they are gitignored /
  never committed) — running the seed script or the Vitest suite for real in a fresh environment
  needs them recreated from `.env.example`/`.env.test.example` first, same as every prior phase;
  they were recreated transiently in this sandbox only to confirm the local Postgres password,
  then removed again since `node_modules` doesn't exist here to actually execute anything against
  them (see the entry above).
  Phase 10's migration (`prisma/migrations/20260816010000_phase10_accounting/migration.sql`) adds
  six enums and nine new tables (`chart_of_accounts`, `accounting_periods`, `journal_entries`,
  `journal_entry_lines`, `financial_transactions`, `expense_categories`, `vendors`, `expenses`,
  `expense_attachments`); hand-written and applied clean to both the dev and test local Postgres
  databases (via the same `/root` 700-permission `/tmp`-copy workaround as Phase 9). A
  10-assertion smoke test verified: a 3-line balanced entry sums exactly; a line with
  debit=credit=0 rejected by the `CHECK` constraint; a line with both debit>0 and credit>0
  rejected by the same `CHECK`; an entry can be reversed at most once
  (`reversalOfEntryId`'s `@unique`); `financial_transactions` rejects a duplicate
  `(referenceType, referenceId, type)` idempotency key; deleting a `chart_of_accounts` row
  referenced by a posted line is blocked (`RESTRICT`); deleting a journal entry cascades its
  lines; expense/category/vendor/journal-entry wiring round-trips exactly (₱25,000.00); deleting
  a `Vendor` `SET NULL`s the expense's `vendorId` (preserving expense history, unlike Phase 9's
  `Supplier`, which is `RESTRICT`); and an undocumented `JournalEntryStatus` value is rejected by
  the enum type. All passed. One genuine bug was caught and fixed during this phase's own
  self-review, before it ever reached a test run: `AccountingService.postAutomaticEntry`'s
  idempotency pre-check originally built its `include` as
  `{ journalEntry: { include: JOURNAL_ENTRY_INCLUDE.lines } }` — since `JOURNAL_ENTRY_INCLUDE` is
  `{ lines: { include: { account: true } } }`, `.lines` there is `{ include: { account: true } }`,
  so the nested include became `{ journalEntry: { include: { include: { account: true } } } }` —
  an invalid shape (an `include` field named "include") that `tsc` cannot catch in this sandbox
  since Prisma Client's generated types don't exist here (the whole expression collapses to
  `any`). Fixed to reuse `JOURNAL_ENTRY_INCLUDE` directly:
  `{ journalEntry: { include: JOURNAL_ENTRY_INCLUDE } }`. Worth flagging as a category of bug this
  sandbox's TS-syntax-only verification cannot catch by construction — any Prisma query-shape
  mistake needs a careful manual re-read (which is what caught this one), since the module
  resolution failure that produces the `TS2307`-cascade-to-`any` filtering pattern this whole
  session relies on also means the compiler can't validate `include`/`where`/`select` shapes at
  all. The `git stash -u` before/after TypeScript diff (checked out to the pre-Phase-10 commit
  `5bdc892`, re-ran `tsc --noEmit`, popped the stash back) confirmed the same result as every
  prior phase: baseline was 2,181 diagnostics, after Phase 10 was 2,613 — 432 more, entirely
  inside already-established categories (`TS7026` +256, `TS7006` +150, `TS2307` +25, `TS2882` +1
  — one new `server-only` import in `AccountingService.ts`, the identical pattern every other
  service file hits). Zero new diagnostic categories. The two pre-existing non-artifact
  diagnostics (`TS2345` in `app/dashboard/layout.tsx`, `TS18046` in `lib/utils/api-error.ts`) are
  unchanged from every prior phase's count. No `TS2322` key-prop diagnostic appeared —
  `finance-board.tsx`'s list renders (accounts by type, journal entries, journal entry lines,
  trial balance rows, periods, expenses, vendors, expense categories) all render their `.map()`
  rows inline, same discipline as every phase since 6. Also worth noting: `prisma/seed.ts`
  deliberately never imports service classes (their `server-only` imports only resolve correctly
  inside the Next.js server runtime, not a plain `tsx`/`node` script) — so this phase's chart-of
  -accounts seeding for the demo org, and its one hand-posted "approved expense" example, are
  hand-mirrored copies of `AccountingService`'s own logic rather than calls into it, same
  discipline as every prior phase's seed data. A second, unrelated `tsc` finding surfaced while
  writing that hand-mirrored code: `new Map(rows.map((a) => [a.name, a]))` (building a
  name-keyed lookup straight from a `.map()` callback) infers the Map's value type as `{}`, not
  the row type, under this project's `noUncheckedIndexedAccess` + `strict` settings once a
  Prisma-typed (`any`, in this sandbox) source is involved — confirmed via a minimal standalone
  repro, and not new to Phase 10's own code (`AuthService.ts`'s pre-existing `permissionByKey`
  hits the identical inference gap, just never surfaced as an error because nothing ever
  dereferences a property off one of its `.get()` results). Fixed everywhere this phase
  introduced the pattern (`prisma/seed.ts`, both new accounting test files) by switching to an
  explicit `new Map<string, (typeof rows)[number]>()` plus a populate-by-loop — the same shape
  `itemByName`/`categoryByName` already used elsewhere in `seed.ts`. Worth remembering for any
  future phase that reaches for `new Map(x.map(...))` against a Prisma query result.

- **Phase 11 could not execute `ReportingService.ts` itself in this sandbox** (no `node_modules`,
  no generated Prisma Client — same constraint as every phase). Beyond the usual
  TS-syntax-only `tsc` check and the Vitest integration suite (also unexecuted here, same as every
  phase — see the top of this section), this phase's three report-generation formulas (income
  statement, balance-sheet identity, cash-flow direct method) were additionally re-derived by hand
  as raw SQL and run for real against a live local Postgres database, in a
  `BEGIN; ... DO $$ ... $$; ROLLBACK;` smoke test mirroring the same transaction mix as
  `tests/integration/reporting/reporting-service.test.ts`'s cash-flow test (an owner capital
  contribution, a Cash/AR-split sale, COGS, rent both on-account and via bank, an equipment
  purchase, loan proceeds, a cash-to-bank transfer, an intentionally-unclassified custom account,
  and an unposted `DRAFT` entry). All four checks passed: income statement (revenue 1,000.00, COGS
  400.00, gross profit 600.00, net profit −9,500.00), balance sheet (assets 505,550.00 = liabilities
  15,050.00 + equity 500,000.00 + net income −9,500.00), cash flow (operating 600.00, investing
  −2,000.00, financing 505,000.00, unclassified 50.00, net 503,650.00 = ending cash 503,650.00 −
  beginning cash 0.00), and confirmation that the `DRAFT` entry's ₱99,999.00 never appears in any
  aggregate. The migration (`prisma/migrations/20260817010000_phase11_reporting/migration.sql`)
  adds one enum (`CashFlowCategory`) and two columns to `chart_of_accounts`
  (`isCashEquivalent`, `cashFlowCategory`) — applied clean to both the dev and test local Postgres
  databases via the same `/tmp`-copy workaround as every prior phase. The `git stash -u`
  before/after TypeScript diff (checked out to the pre-Phase-11 commit `71c813e`, re-ran
  `tsc --noEmit`, popped the stash back) confirmed the same result as every prior phase: baseline
  was 2,612 diagnostics, after Phase 11 was 2,805 — 193 more, entirely inside
  already-established categories (`TS7026` +174, `TS7006` +8, `TS2307` +10, `TS2882` +1 — one new
  `server-only` import in `ReportingService.ts`, the identical pattern every other service file
  hits). Zero new diagnostic categories. The two pre-existing non-artifact diagnostics (`TS2345`
  in `app/dashboard/layout.tsx`, `TS18046` in `lib/utils/api-error.ts`) are unchanged. No `TS2322`
  key-prop diagnostic appeared — the new Reports section's list renders (income statement/balance
  sheet account rows, cash-flow line items, dashboard cards) all render their `.map()` rows
  inline, same discipline as every phase since 6. `lib/utils/timezone.ts` has zero diagnostics of
  its own (a self-contained file with no external imports) — its date-range math was additionally
  spot-checked by running it directly with `tsx` against concrete Asia/Manila timestamps (not just
  type-checked), confirming every preset's boundary (week starts Monday, month/quarter/year
  boundaries) matches hand computation exactly before it was relied on by any report.

## Required Environment Variables

See `.env.example` for the full list. Minimum to run Phase 1 locally:
`DATABASE_URL`, `AUTH_SECRET`, `APP_URL`.
