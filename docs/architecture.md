# Architecture

## 1. Repository Assessment (Phase 0)

The repository was empty at the start of this build. No prior framework, database, deployment
config, tests, or environment variables existed. This document, together with `CLAUDE.md` and
`docs/database.md`, records the architecture decided for a greenfield build.

## 2. System Overview

```
                        ┌─────────────────────────┐
                        │        Clients           │
                        │  Web (Next.js), future    │
                        │  Android/iOS via shared   │
                        │  API + Expo/React Native  │
                        └─────────────┬─────────────┘
                                      │ HTTPS
                        ┌─────────────▼─────────────┐
                        │     Next.js Application    │
                        │  App Router (UI) +          │
                        │  Route Handlers (API)       │
                        └─────────────┬─────────────┘
                                      │
                        ┌─────────────▼─────────────┐
                        │        Service Layer        │
                        │ AuthService, OrganizationService,
                        │ BranchService, (later) Reservation/
                        │ Order/Catering/Inventory/Accounting/
                        │ CRM/Analytics/Notification services
                        └─────────────┬─────────────┘
                                      │ Prisma
                        ┌─────────────▼─────────────┐
                        │        PostgreSQL           │
                        └─────────────────────────────┘

        Cross-cutting: lib/auth (sessions/RBAC), lib/validation (Zod),
        lib/payments, lib/notifications, lib/ai — all provider-abstracted.
```

## 3. Multi-Tenant / Multi-Branch Model

```
Organization
    ↓
Branches
    ↓
Tables, Employees, Orders, Reservations, Inventory, Finance
```

Every business record is scoped by `organizationId` (and `branchId` where applicable). A user's
session carries their `organizationId` and roles; every service call is scoped to that
organization. There is no cross-tenant read or write path.

## 4. Layering Rules

- **UI (`app/**`, `components/**`)**: presentation only. Calls API routes via `fetch`/TanStack
  Query. Never talks to Prisma directly, never contains pricing/tax/accounting math.
- **API (`app/api/**/route.ts`)**: authentication check → authorization check → Zod validation →
  call one service method → shape the HTTP response. No business logic here.
- **Services (`services/**`)**: all business logic and orchestration. Own the Prisma calls for
  their domain, use `prisma.$transaction` for multi-step writes, throw typed errors the API layer
  translates to HTTP status codes.
- **lib (`lib/**`)**: shared, stateless building blocks — auth primitives, validation schemas,
  accounting math, provider abstractions.

## 4a. Deviation from the spec's literal folder structure

The master spec's example tree shows `(dashboard)/` as a Next.js *route group* (parens = no URL
segment) containing `dashboard/`, `reservations/`, `tables/`, etc. Taken literally that produces
bare, unprefixed routes — `/reservations`, `/tables`, `/orders` — which collide head-on with the
customer-facing `(customer)/` group's `reservations/`, `orders/`, etc. (also unprefixed by
design). Two different pages cannot both own `/orders`.

Resolution: staff/owner pages live under a real path segment, `app/dashboard/`, so they resolve to
`/dashboard`, `/dashboard/reservations`, `/dashboard/tables`, ... — no collision with the
customer-facing `/orders`, `/reservations`, etc. `middleware.ts` already gates everything under
`/dashboard/*`, so this also made the auth-redirect matcher correct instead of a no-op. Same
architectural separation as the spec (dashboard components/services/APIs are still fully modular),
just a corrected URL scheme.

## 5. Technology Stack

| Concern | Choice | Why |
|---|---|---|
| Frontend framework | Next.js 14 (App Router) | SSR + API routes in one deployable, per spec |
| Language | TypeScript (strict) | Type safety for financial/business logic |
| Styling | Tailwind CSS + shadcn/ui-style components | Fast, consistent, accessible-by-default |
| Data fetching | TanStack Query | Caching, loading/error states out of the box |
| Forms | React Hook Form + Zod | Client + server validation from one schema |
| Database | PostgreSQL | Transactions, constraints, relational integrity required for accounting |
| ORM | Prisma | Type-safe queries, migration history, matches spec |
| Auth | Custom (bcrypt + JWT session cookie) | Full control over multi-role, multi-tenant sessions; no vendor lock-in for Phase 1 |
| Testing | Vitest (unit/integration), Playwright (e2e) | Fast, TS-native; Playwright already available in this environment |

## 6. Implementation Phases

0. Discovery (this document) — **done**
1. Foundation: Next.js/TS/Tailwind, Postgres/Prisma, auth, RBAC, organizations, branches — **done**
2. Restaurant configuration: branches detail, tables, sections, business hours, menu, categories, modifiers — **done, this pass**
3. Reservations: availability engine, deposits, confirmation, cancellation, no-show, concurrency tests
4. Orders: dine-in, take-out, delivery, payments, invoices
5. Kitchen display system
6. Delivery: zones, drivers, assignment, tracking
7. Catering: inquiry → quote → accept → deposit → event → final payment
8. CRM: profiles, history, RFM segmentation, lifetime value
9. Inventory: ingredients, recipes, purchasing, stock, waste, COGS integration
10. Accounting: chart of accounts, journal entries, double-entry ledger, deposits, reversals
11. Financial reporting: income statement, balance sheet, cash flow, trial balance
12. Owner analytics dashboards
13. AI business intelligence (read-only analytics tools only)
14. Notifications: email, push, SMS abstraction
15. Hardening: security/performance/accessibility/financial-integrity review
16. Deployment: production DB, migrations, backups, monitoring, domain, HTTPS, app builds

Each phase follows: explain → identify affected tables/APIs/security implications/tests → implement →
test → typecheck/lint → review → update docs → commit.

## 7. Risks

- **No payment provider is connected yet.** `lib/payments` defines the `PaymentProvider`
  interface; a real provider (e.g. a PH-market gateway) must be selected and configured before
  Phase 4 can accept real money. Flagged for a business decision, not a default I should silently
  pick given it affects payments/compliance.
- **Philippine tax/accounting compliance is not verified.** The accounting engine is technically
  sound (double-entry, immutable postings) but VAT treatment, official receipt/invoice sequencing,
  and withholding rules need sign-off from a licensed PH accountant before Phase 10 is considered
  done.
- **This build environment cannot install npm packages** (see `CLAUDE.md` → Known Issues). All
  Phase 1 code is authored and syntax-checked but not yet runtime-verified. This is a hard
  environment constraint, not a scope decision — flagged clearly rather than glossed over.
- **Multi-tenant isolation** is enforced by convention (every query scoped by
  `organizationId`) rather than Postgres row-level security in Phase 1. Revisit RLS as a
  defense-in-depth layer during Phase 15 hardening.

## 8. Required External Integrations (all currently unconfigured, by design)

- Payment provider (PH market: e.g. PayMongo, Maya, Stripe — decision needed)
- Transactional email provider
- SMS provider
- Push notification provider
- S3-compatible object storage
- Maps/geocoding API (delivery zones/driver navigation)
- AI provider (business intelligence layer, read-only access only)

## 9. What Was Implemented First

Phase 1 Foundation, scoped exactly to: project scaffold, database schema for
organizations/branches/users/roles/permissions, authentication, RBAC, org & branch CRUD, a
minimal dashboard/login UI shell, seed data, and tests for the above. Everything else is
deliberately deferred to keep each phase reviewable, per the "do not build the entire application
in one uncontrolled pass" rule.

## 10. Phase 2 — Restaurant Configuration

Built on top of Phase 1 without modifying its schema: table sections, tables (with a whitelisted
status state machine — see `TableService.ALLOWED_TRANSITIONS`), table status history, business
hours (via the `Branch.openingHours` field already added in Phase 1, now with a real editor UI),
and the full menu (categories, items, variants, modifier groups, modifiers, item↔modifier-group
links). Menu is organization-scoped, not branch-scoped — the spec's field list for `menu_items`
doesn't include a branch id, so all branches in an organization currently share one menu.
Per-branch availability overrides are a reasonable future addition, not built here (would need a
join table like `branch_menu_item_overrides`, deferred until an actual multi-branch customer
needs it — no fields added speculatively).

Both the table state machine and the menu's decimal pricing were chosen deliberately over looser
alternatives: table status transitions are validated against a whitelist server-side (a client
requesting `OUT_OF_SERVICE → OCCUPIED` directly is rejected, not silently allowed), and every
money field uses Postgres `DECIMAL(10,2)` end to end — verified with a SQL smoke test proving no
float drift (see `CLAUDE.md` → Known Issues).
