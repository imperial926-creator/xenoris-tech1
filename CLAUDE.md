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

**Not yet built** (Phases 4–16 per `docs/architecture.md`): orders, kitchen display, delivery,
catering, CRM/RFM, inventory, accounting ledger, financial reporting, owner analytics, AI
insights, notifications, hardening, deployment.

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
- Payment, email, SMS, push, storage, maps, and AI providers are all unconfigured placeholders —
  see `.env.example`. No fake integrations were built.

## Required Environment Variables

See `.env.example` for the full list. Minimum to run Phase 1 locally:
`DATABASE_URL`, `AUTH_SECRET`, `APP_URL`.
