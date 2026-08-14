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

**Phase 1 — Foundation: in progress / see below for exact scope.**
Implemented in this pass:
- Next.js 14 + TypeScript + Tailwind + App Router project structure matching the target folder
  layout.
- Prisma schema: `Organization`, `Branch`, `User`, `Role`, `Permission`, `RolePermission`,
  `UserRole`, `AuditLog` (foundation only — no restaurant-domain tables yet, those arrive in later
  phases).
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

**Not yet built** (Phases 2–16 per `docs/architecture.md`): restaurant configuration (tables,
menu), reservations, orders, kitchen display, delivery, catering, CRM/RFM, inventory, accounting
ledger, financial reporting, owner analytics, AI insights, notifications, hardening, deployment.

## Known Issues / Environment Constraints

- **Login requires an "organization email" alongside the user's own email.** Because `User.email`
  is unique per-organization (not globally — the same person may be a customer of two different
  restaurant organizations on the platform), a login request must disambiguate which organization
  to check credentials against. Phase 1 does this by asking for the organization's own (globally
  unique) contact email. This is functional but not great UX; a friendlier flow (org
  slug/subdomain, or "look up my organizations by email") is a good Phase 2 candidate.

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
- Payment, email, SMS, push, storage, maps, and AI providers are all unconfigured placeholders —
  see `.env.example`. No fake integrations were built.

## Required Environment Variables

See `.env.example` for the full list. Minimum to run Phase 1 locally:
`DATABASE_URL`, `AUTH_SECRET`, `APP_URL`.
