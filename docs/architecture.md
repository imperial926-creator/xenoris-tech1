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

The same reasoning applies one level down to API routes for branch-scoped domains. Phase 1
scaffolded a flat `app/api/reservations/` placeholder mirroring the spec's flat table list, but
every reservation always belongs to exactly one branch (like tables), so Phase 3 nests it the same
way tables already are: `app/api/branches/[id]/reservations/**`, not a flat `app/api/reservations/`.
The flat placeholder was removed once the real, branch-scoped routes existed — org-scoped domains
like menu correctly stay flat under `app/api/menu/**` (see § 10), since a menu isn't owned by one
branch.

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
2. Restaurant configuration: branches detail, tables, sections, business hours, menu, categories, modifiers — **done**
3. Reservations: availability engine, deposits, confirmation, cancellation, no-show, concurrency tests — **done**
4. Orders: dine-in, take-out, delivery, payments, invoices — **done**
5. Kitchen display system — **done**
6. Delivery: zones, drivers, assignment, tracking — **done, this pass**
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

- **No payment provider is connected yet.** `lib/payments/PaymentProvider.ts` (written in Phase 4)
  defines the `PaymentProvider` interface and an `UnconfiguredPaymentProvider` stub that throws
  rather than fakes success; a real provider (e.g. a PH-market gateway) must be selected and
  configured before the platform can accept real electronic payments. Cash/manual payments are
  already supported today via `OrderPayment` (Phase 4) — staff record that money changed hands,
  the same way Phase 3 handles reservation deposits. Flagged for a business decision, not a
  default I should silently pick given it affects payments/compliance.
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

## 11. Phase 3 — Reservations

Built on top of Phases 1/2: availability search, multi-table assignment (for parties larger than
any single table), a reservation status state machine (same whitelist pattern as
`TableService.ALLOWED_TRANSITIONS`, applied to `ReservationStatus`), manual deposit recording, and
a soft business-hours check.

The headline decision is where double-booking prevention actually lives. `ReservationService` does
run an application-level availability check before creating a reservation — but that check has an
inherent TOCTOU (time-of-check-to-time-of-use) race: two staff members could both pass the check a
moment apart and both attempt to book the same table. The real guarantee is a Postgres `EXCLUDE`
constraint (`no_double_booking`, using the `btree_gist` extension) declared directly on
`reservation_tables` in hand-written migration SQL — Prisma's schema DSL cannot express EXCLUDE
constraints, so this is intentionally invisible to `schema.prisma` itself (documented there and in
`docs/database.md`). This constraint is what was actually verified under real concurrency: two
separate `psql` processes racing to book the same table/window, with the loser rejected by
Postgres mid-transaction — see `CLAUDE.md` → Known Issues for the full account. An automated
Vitest test reproduces the same race at the service layer with `Promise.allSettled`.

Two things were deliberately deferred rather than half-built:

- **No separate guest/customer table.** `Reservation` stores a contact snapshot
  (`guestName`/`guestEmail`/`guestPhone`) plus an optional `customerUserId` for registered
  accounts. A real CRM `Customer` model with history, preferences, and RFM segmentation is Phase 8
  — adding it now would mean either an empty table or a half-built CRM ahead of schedule.
- **No payment gateway integration.** Deposits are staff-recorded attestations ("cash received,
  confirmed by phone"), not real transactions. `lib/payments`'s `PaymentProvider` interface is
  still unconfigured (see § 7 Risks) and reservation deposits will connect to a real ledger once
  Phase 4 (order payments) and Phase 10 (accounting) exist.

Scope is also deliberately staff-side only: the dashboard UI under `/dashboard/reservations` lets
staff search availability and manage bookings, but public customer self-service booking is not
built here. It needs customer-facing authentication, which doesn't exist yet — the current
`/register` flow only creates organization-owner accounts — Phase 3's own wrap-up floated bundling
it into Phase 4 alongside customer ordering; § 12 below explains why that didn't happen either.

## 12. Phase 4 — Orders, Payments, Invoicing

Built on top of Phases 1-3: order creation and pricing, a status state machine, manual payment
recording, and sequential invoicing.

**Server-computed pricing, no exceptions.** `OrderService.resolveAndPriceItems` accepts only IDs
and quantities from the client — menu item, variant, and modifier prices are always looked up
fresh from the database, never trusted from the request body. The same method enforces each
modifier group's `required`/`minSelect`/`maxSelect` rules per order line before any money is
computed. `OrderItem` and `OrderItemModifier` then snapshot `nameSnapshot`/`unitPriceSnapshot`/
`priceDeltaSnapshot` onto the order row itself — the same snapshotting principle Phase 3 applied
to reservation guest contact info — so a later menu price change or item rename never rewrites the
history of what a customer was actually charged. A provisional 12% PH VAT applies only to
`STANDARD`-tax-category lines; this rate is a placeholder, not a configured, accountant-approved
figure (see § 7 Risks).

**Table auto-transition reuses Phase 2's state machine, with one race fixed.** A new dine-in order
best-effort transitions its table to `OCCUPIED` via `TableService`'s existing whitelist (a table
that's `OUT_OF_SERVICE` or `CLEANING` rejects the order instead of silently seating it). The first
implementation read the table's current status once before opening the database transaction and
passed that snapshot into the seating logic — a classic time-of-check-to-time-of-use race, the
same category of bug Phase 3 was careful to avoid for double-booking. It was caught during
self-review (not by a test failing) and fixed by re-reading the table's status *inside* the
transaction, immediately before deciding whether to seat it, so the decision is always made
against the latest committed state.

**Invoicing needed a different concurrency mechanism than Phase 3's, because it's a different
guarantee.** Reservations needed "reject any overlap" (solved with a Postgres `EXCLUDE`
constraint). Invoicing needs "hand out the next number safely, with no gaps skipped and no
duplicates" — a monotonic counter, not an overlap check. `InvoiceService.issueInvoice` solves this
with an atomic `upsert` on a per-branch `InvoiceSequence` row (`lastNumber: { increment: 1 }`)
inside the same transaction as the `Invoice` insert, relying on Postgres's own row-locking on the
UPDATE path rather than a novel constraint. This was proven under genuine concurrency the same way
Phase 3's constraint was: a `Promise.allSettled` test issues invoices for 5 fully-paid orders on
one branch truly simultaneously and asserts all 5 succeed with unique, correctly sequential
numbers (see `CLAUDE.md` → Known Issues for the full run). Separately, "at most one active invoice
per order" is enforced by a partial unique index
(`invoices_one_active_per_order ... WHERE status != 'VOID'`) — like Phase 3's `EXCLUDE`
constraint, this has no Prisma schema DSL representation and is hand-written directly into
migration SQL.

**No payment gateway, by design (see § 7 Risks).** `lib/payments/PaymentProvider.ts` is written
this phase — closing a gap where `docs/architecture.md` had referenced this interface since Phase
1 without the file actually existing — but its only implementation is
`UnconfiguredPaymentProvider`, which throws on every method rather than faking a successful
charge. Payments actually taken today go through `OrderPayment`: staff record that cash/card/
e-wallet money changed hands, exactly the same "attestation, not a fake gateway" pattern Phase 3
used for reservation deposits. `OrderService.paymentSummary` derives `paidAmount`, `balanceDue`,
and `isFullyPaid` from that ledger (`Σ COMPLETED − Σ REFUNDED`), and an order must be fully paid
before `InvoiceService.issueInvoice` will issue against it.

**Scope boundary, and a deliberate re-scoping from what Phase 3 announced.** This phase is
staff-side order management only — kitchen display (Phase 5) and delivery dispatch (Phase 6) were
explicitly out of scope from the start. Phase 3's wrap-up, however, had also floated public
customer self-service ordering (and the customer-facing authentication it needs) as riding along
with Phase 4. On reflection that combination was too much for one reviewable pass: Phase 4's
staff-side surface alone is a full pricing engine, a state machine, manual payments, and a
concurrency-proven invoicing sequence. Building customer-facing auth and a storefront ordering UI
in the same pass would have meant rushing one of the two, or growing this phase well past the
"do not build the entire application in one uncontrolled pass" rule from § 6. Customer self
-service ordering is therefore explicitly re-scoped out of Phase 4 and deferred to its own later,
dedicated pass, once customer-facing authentication is designed on its own terms rather than
bolted on as a side effect of the orders schema. Two further things were deliberately deferred
rather than half-built:

- **No dedicated payments/transactions ledger table beyond `OrderPayment`.** A real accounting
  ledger (`journal_entries`/`journal_entry_lines`) is Phase 10 — `OrderPayment` records what staff
  attest happened; it does not post double-entry accounting movements. Wiring order payments and
  invoices into the general ledger happens once Phase 10 exists.
- **No refund-to-original-payment-method automation.** A `REFUNDED` `OrderPayment` row is a manual
  record (same as a `COMPLETED` one) — there is no gateway to actually reverse a charge through,
  since no gateway is connected yet.

## 13. Phase 5 — Kitchen Display System

The master spec's Kitchen Display section (§20) is short and deliberately so: "Create a kitchen
dashboard" showing new orders, items, modifiers, special instructions, table/order type, required
time, and current status, moving through NEW → ACCEPTED → PREPARING → READY. Notably, unlike every
other phase's spec section, it lists **no new database tables**.

The headline decision is to take that omission seriously rather than pattern-match "new phase, new
tables." NEW/ACCEPTED/PREPARING/READY is not a new state machine — it is `OrderStatus`'s
`PENDING`/`CONFIRMED`/`PREPARING`/`READY` values, the exact lifecycle Phase 4 already built,
tested (including the full legal-transition-walk and illegal-transition-rejection tests), and
shipped. `COMPLETED` (picked up/served) and `CANCELLED` remain whole-order/front-of-house
concerns already handled by `OrderService` — the kitchen's job ends at `READY`. Building a second,
parallel `KitchenTicketStatus` enum kept in sync with `OrderStatus` would create two sources of
truth for one piece of business logic, the exact failure mode this codebase's Coding Conventions
(`CLAUDE.md`) already warn against. So `KitchenService` does not own a state machine at all — it
owns a read model (`getQueue`: active tickets, oldest first, kitchen-relevant fields only) and a
one-line orchestration convenience (`advanceStatus`: "what's the next kitchen stage from here",
then delegate the actual transition to `OrderService.updateStatus`, which re-validates it against
its own whitelist regardless). The only genuinely new schema is `Order.requiredAt`, a nullable
column for the spec's "Required time" — every other field the kitchen board needs (order number,
items, modifiers, special instructions, table, order type, status) already existed on
`Order`/`OrderItem` from Phase 4.

This also settles the `kitchen:view` permission's status. It was declared in the permission
catalog back in Phase 1 as a forward-looking placeholder (`PERMISSION_CATALOG`, granted to
STAFF/MANAGER/OWNER/ADMINISTRATOR by `DEFAULT_ROLE_PERMISSIONS` from day one) but never wired into
an actual authorization check until now — the read-only kitchen queue endpoint is gated by it.
Advancing a ticket's status reuses `order:manage`, the same permission Phase 4's general
order-status endpoint requires, since under the hood it is the same mutation
(`OrderService.updateStatus`) either way; a narrower `kitchen:view`-only capability to *change*
status was considered and rejected — a cook moving a ticket forward is exactly as privileged an
action as a server changing an order's status from the Orders board, so gating it more loosely
than that other entry point into the same state machine would be a real, exploitable inconsistency
rather than a helpful narrowing.

**"Use real-time updates where practical" is implemented as client-side polling, not push.** This
build has no WebSocket, Server-Sent Events, or managed pub/sub provider (Pusher/Ably/etc.)
configured — the same "report unconfigured honestly, don't fake it" rule already governing
payments/email/SMS/push in the Deployment Rules section of `CLAUDE.md`. Standing up real push
infrastructure is a legitimate provider decision (which service, what it costs, where webhooks
land) that shouldn't be silently defaulted inside a phase whose actual scope is the kitchen
workflow itself. Polling the queue endpoint every few seconds is the practical option available
without adding unconfigured infrastructure, and it is genuinely adequate for a kitchen-line use
case (staff are looking at a mounted screen, not waiting on sub-second latency) — flagged here as
a known simplification, not hidden as if it were true push.

Scope boundary: this phase is the kitchen-facing board only. It does not touch delivery dispatch
(Phase 6, drivers/zones/assignment) or any customer-facing "your order is ready" notification
(Phase 14, notifications) — both explicitly out of scope from the original Phase 4/5 kickoff and
unaffected by anything built here.

## 14. Phase 6 — Delivery

Master spec §18-19 asks for delivery zones, driver assignment/tracking, delivery status, proof of
delivery, and a driver-scoped view restricted to "deliveries they are authorized to access." Unlike
Phase 5, this section of the spec *does* name new tables (`delivery_orders` explicitly), and unlike
Phase 5's reuse of `OrderStatus`, dispatch progress genuinely is a second axis, not the same one
relabeled: a driver can be `ASSIGNED` and en route to the restaurant while the kitchen is still
`PREPARING`, and a delivery can be `DELIVERED` while the parent order is still open for a
follow-up. Two real axes get two real state machines — `DeliveryStatus` is its own enum with its
own whitelist in `DeliveryService`, and `DeliveryService` never writes `Order.status` (nor does
`OrderService` ever write `DeliveryOrder.status`). Whether a delivered order should
auto-complete the parent `Order` was considered and deliberately left as a manual staff/manager
decision rather than an automatic side effect — a debatable business call better made by the
restaurant than baked into the platform silently.

`DeliveryOrder` is a 1:1 companion table to `Order` (a nullable `Order.delivery` relation backed
by a `@unique orderId` foreign key), not a set of nullable columns bolted directly onto `Order` —
the alternative would permanently block dine-in/take-out rows with always-null delivery columns.
It is created inside the *same transaction* as the parent `Order` whenever `type === 'DELIVERY'`,
so an order and its delivery record can never exist independently of each other. The one
deliberate exception to "delivery data lives on `DeliveryOrder`" is `deliveryFee`, which is
snapshotted onto `Order` itself as well — not because of denormalization for its own sake, but
because `Order.total` (and therefore every payment/invoice calculation downstream) has to include
it, and requiring every reader to join to `DeliveryOrder` just to compute a correct total would be
a real correctness footgun. Both fields are written atomically in the same transaction from the
same snapshot value, so this is one source of truth captured twice, not two sources of truth.

`Driver` is a separate profile table from `User`+the `DRIVER` role, carrying operational fields
(vehicle type/plate, phone, active) that have no reason to live on the authentication/RBAC side of
the system — the same "role grants capability, profile carries domain data" split `Order` and
`Reservation` already use for their optional `customerUserId`. A user can hold the `DRIVER` role
without yet having a `Driver` profile (a manager grants the role, then separately creates the
profile), which is exactly what `DriverService.listEligibleUsers` exists to support — deliberately
narrow (DRIVER-role users without a profile yet, nothing more) rather than a general staff
directory, since full `user:view` implementation is still Phase 1's unimplemented placeholder.

`DriverAssignment` is an append-only audit trail, kept separate from both `DeliveryOrder.driverId`
(the current-value pointer used for everyday queries) and `DeliveryStatusHistory` (the status
timeline) — reassignment is its own timestamped event (`assignedAt`/`unassignedAt`) worth its own
record, the same "denormalized current value + full history table" pattern `TableStatusHistory`
and `OrderStatusHistory` already established, just as its own table rather than folded into the
status history because a driver reassignment is a materially different kind of event from a status
transition.

Master spec §19's "drivers must only see deliveries they are authorized to access" is enforced
structurally, not just by a query filter a client could omit: `GET /api/deliveries/mine` is a
dedicated, non-branch-nested route whose only inputs are session-derived (`organizationId`,
`userId` — never a client-supplied driver ID), and `DeliveryService.myDeliveries` resolves the
caller's own `Driver` profile via `DriverService.getByUserId` before it will filter anything. A
driver cannot request another driver's queue by guessing or supplying an ID, because no endpoint
ever accepts one from a driver-facing caller.

**No fake integrations, once again.** A `DeliveryZone` is a plain staff-named area with a flat fee
— there is no geofencing, address validation, or maps/geocoding API configured, so zones are not
automatically derived from an address. Proof of delivery is a staff/driver-entered text note plus
an optional recipient name, not a photo — no object storage provider is configured. The driver
UI's "navigation" affordance is a plain `https://maps.google.com/?q=<address>` deep link to an
external maps app, explicitly commented as such in the code — not an integrated routing/ETA
feature, which would require a real maps API key this build does not have.

Scope boundary: this phase is dispatch and driver-facing status/tracking only. It does not touch
customer-facing delivery tracking (a customer-visible "where's my order" view is a reasonable
future feature building on the same `DeliveryOrder` data, not built here) or any SMS/push
"your driver is on the way" notification (Phase 14).
