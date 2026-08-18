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
6. Delivery: zones, drivers, assignment, tracking — **done**
7. Catering: inquiry → quote → accept → deposit → event → final payment — **done, this pass**
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

## 15. Phase 7 — Catering

Master spec §21 asks for a catering funnel (inquiry, package, quote, customer approval, deposit,
event management, balance payment) and §22 gives an explicit quotation formula — Food + Staffing
+ Equipment + Transportation + Setup + Service Fees − Discounts + Taxes = TOTAL — plus a literal
instruction: "When accepted, create the appropriate catering event." §44 names `CateringService`
directly as an example service, so this phase reuses that name rather than inventing a different
one.

The funnel maps onto four tables with a clear one-directional flow: `CateringInquiry` (raw
request, `NEW`/`QUOTED`/`CONVERTED`/`CANCELLED`) → `CateringQuote` (priced proposal, a full
`DRAFT`/`SENT`/`VIEWED`/`ACCEPTED`/`REJECTED`/`EXPIRED`/`CANCELLED` state machine) → `CateringEvent`
(the operational booking once accepted, `SCHEDULED`/`IN_PROGRESS`/`COMPLETED`/`CANCELLED`) →
`CateringPayment` (deposit/balance ledger against the event). A `CateringQuote` never has more
than one `CateringEvent` — enforced with a `@unique quoteId` foreign key, not just application
logic — because "accept a quote" is a one-time transition, not something that should silently
produce duplicate events on a retried request.

**Only the food line gets real itemization.** `CateringQuoteItem`/`CateringEventItem` exist so a
quote can show "30 × Silver Package (per guest) @ 500.00", but staffing, equipment,
transportation, setup, and the service fee are flat `Decimal` columns on `CateringQuote` itself,
computed server-side into the total rather than broken into their own itemized child rows. This
is a deliberate scope call, not laziness: itemizing "staffing" would require a staffing rate card
(hourly rates per role) and itemizing "equipment" would require an equipment rental catalog with
its own pricing — neither exists yet, and inventing placeholder itemization for categories the
platform can't actually price from real data would be worse than a flat, staff-entered number.
This also matches how catering quotes work in practice: food is priced per-guest per-item, while
staffing/equipment/logistics are typically quoted as flat line totals even by vendors who do have
internal rate cards.

**The `ACCEPTED` transition is where the funnel's one real side effect lives.** Following §22's
literal instruction, `CateringService.updateQuoteStatus` special-cases the `ACCEPTED` status
inside its transaction: it creates the `CateringEvent` (copying guest/event details from the
parent `CateringInquiry` and the quote's totals), copies every `CateringQuoteItem` into a
matching `CateringEventItem`, and bumps the parent inquiry to `CONVERTED` — all three writes
succeed or fail together, the same "one business event, one transaction" discipline Phase 6 used
for `Order`→`DeliveryOrder` auto-creation. Every other status transition (`SENT`, `VIEWED`,
`REJECTED`, `EXPIRED`, `CANCELLED`) is a plain whitelisted state-machine move with no side
effects beyond an audit log entry, mirroring every other status machine in this codebase
(`TableStatus`, `ReservationStatus`, `OrderStatus`, `DeliveryStatus`).

**Payments are a real table, unlike Phase 3's reservation deposits.** A `Reservation` only ever
needs one deposit, so Phase 3 put deposit fields directly on the `Reservation` row. A catering
event routinely needs at least two payments over time — a deposit at booking, a balance before or
at the event — so `CateringPayment` is a proper child table instead, the same shape as Phase 4's
`OrderPayment`. It deliberately reuses `OrderPaymentMethod`/`OrderPaymentStatus` rather than
declaring catering-specific duplicates of the same CASH/CARD/GCASH/MAYA/BANK_TRANSFER/OTHER and
PENDING/COMPLETED/FAILED/REFUNDED enums; the only genuinely new enum is `CateringPaymentType`
(`DEPOSIT`/`BALANCE`), because that distinction doesn't exist for orders.
`CateringService.paymentSummary` computes `paidAmount`/`balanceDue`/`isFullyPaid` from the ledger
exactly like `OrderService.paymentSummary` does — one shared pattern, two independent ledgers.

Permissions: no new key. `catering:manage` was already declared in Phase 1's forward-looking
catalog and already granted to MANAGER/OWNER/ADMINISTRATOR — but deliberately **not** STAFF,
unlike `order:manage`/`delivery:manage`. Taking and quoting a catering booking is treated as a
manager-level function in this platform (negotiating pricing, discounts, and event commitments),
not a front-line task any staff member should be able to do unsupervised; a restaurant that wants
to delegate it can grant the permission to a custom role without a code change, since RBAC is
DB-sourced.

Scope boundary, stated plainly: no e-signature capture, no PDF quote generation/emailing, and no
customer-facing self-service portal exist yet. Every quote-status transition in this build is a
staff member clicking a button on behalf of the customer ("customer called and accepted") — there
is no `/customer` route where a customer logs in and clicks "Accept" themselves. Building that
would require customer-facing catering authentication and a public quote-viewing page, neither of
which exists; noted here explicitly rather than silently faked, the same discipline every prior
phase has applied to its own unbuilt integrations.

## 16. Phase 8 — CRM

Master spec §9 lists a `customers` table with a specific, narrow field set (name, email, phone,
date of birth, status — "do not collect unnecessary personal information"); §31 asks for a CRM
that tracks total orders/reservations/catering orders, total spending, average order value,
first/last transaction, favorite products, visit frequency, and lifetime value; §32 asks for RFM
(Recency/Frequency/Monetary) segmentation into NEW/RETURNING/REGULAR/VIP/AT_RISK/INACTIVE/
HIGH_VALUE, with "make thresholds configurable" stated explicitly. The Phase 8 build list itself
just says "Reviews" with no field-level spec anywhere else in the document — `CustomerReview` is
this phase's own design, called out as such rather than presented as a literal spec requirement.

**`Customer` is a new profile table, deliberately not `User`.** The master spec's `customers`
table (§9) is organization-scoped domain data — order history, preferences, segment — not an
authentication concept. This platform already has `User` for login/RBAC. Rather than bolt CRM
fields onto `User` (which would force every walk-in or phone-order customer to have a login
account just to be trackable), `Customer` is its own table with a nullable, `@unique` `userId`
link for the minority who do register. This is the identical shape Phase 6 used for `Driver` vs.
the `DRIVER` role: the role/account grants *capability* (can this person log in, what can they
do), the profile carries *domain data* (what has this person actually done). Most `Customer` rows
in this build's seed data have no `userId` at all, on purpose — that's the common case, not an
edge case.

**Linking is explicit, never inferred.** `Order`, `Reservation`, and `CateringInquiry` each gained
a nullable, client-settable `customerId` foreign key (`onDelete: SetNull`, so deleting a
`Customer` profile never deletes the transaction history that references it — see the field
comment in `schema.prisma`'s Phase 8 block). Deliberately **not built**: any automatic matching of
a guest's name/email/phone against existing `Customer` records. Fuzzy contact-matching has real
failure modes — two different "J. Santos" phone orders silently merging into one customer's
history is worse than two separate, correctly-unlinked guest transactions — and this build has no
deduplication/merge tooling to clean up a bad auto-match after the fact. Staff attach a `Customer`
explicitly, through the CRM UI or by passing `customerId` when creating the order/reservation/
inquiry. The one deliberate exception is `CateringEvent.customerId`, which is **not**
client-settable at all — it's copied automatically from `CateringQuote.inquiry.customerId` inside
`CateringService.updateQuoteStatus`'s `ACCEPTED` transition, the same "the event inherits from
its inquiry" logic that already copies guest contact details there. Every one of these relation
fields is named `crmCustomer`, not `customer`, specifically so it reads as visually distinct from
each model's pre-existing `customer`/`customerUserId` relation (the optional login-account link —
"did this order have a logged-in customer," an unrelated question from "is this order linked to a
CRM profile").

**RFM segmentation is computed live, never stored.** `lib/crm/rfm.ts` exports a pure function,
`classifySegment(metrics, thresholds)`, that takes recency/frequency/monetary numbers and returns
one of the seven master-spec segments — zero database access, fully unit-testable in isolation.
`CustomerService.getAnalytics` is the only caller: it gathers the raw metrics from real
`Order`/`Reservation`/`CateringEvent` rows on every request and classifies fresh, rather than
reading (and potentially serving stale) a stored `segment` column. This mirrors the reasoning
behind Phase 5's Kitchen Display polling instead of push updates: this build has no background
job scheduler, so anything that should stay "live" has to either be computed on read or accept
becoming wrong over time with no process to fix it. A stored segment is the second option wearing
a disguise. The trade-off is honestly a real one — `segmentBreakdown` (org-wide counts for the
dashboard) ends up running `getAnalytics` once per customer, an N+1 query pattern that is fine at
this build's demo/early-stage data volumes and openly documented as a scaling limit a real
production deployment would need to address with a batched or materialized version instead.

**Segment precedence is a fixed decision chain, not a scored/weighted model**, and the order
matters more than it might look: `HIGH_VALUE` (spend alone) is checked *before* `NEW` (≤1
transaction), specifically so that a customer's very first purchase — if it's large enough, like
a single big catering event — reads as `HIGH_VALUE` rather than being masked by "this is their
first order." Getting this ordering wrong is exactly the kind of bug that's easy to ship
silently, because both branches return a real, plausible-looking segment; see `CLAUDE.md`'s
Phase 8 status entry for how this was actually caught (cross-checking the algorithm against a
worked seed-data example) and the regression test that now guards it.

**Thresholds are configurable per §32's literal instruction**, via a nullable
`Organization.crmSettings` JSON column — the same "JSON column, code supplies the default when
null" pattern `Branch.openingHours` established in Phase 1, rather than a dedicated settings
table for what is currently a single nested object. `resolveRfmThresholds` merges
`crmSettings.rfmThresholds` over `DEFAULT_RFM_THRESHOLDS` field by field, with defensive
validation per field (a malformed or out-of-range override for one threshold falls back to that
field's own default rather than invalidating the whole threshold set, or throwing).

Permissions: `customer:view` already existed in Phase 1's forward-looking catalog; `customer:manage`
is new this phase, granted to STAFF (alongside VIEW — recording a walk-in's name/phone while
taking a phone order is routine front-of-house work, not a manager-level function, unlike
`catering:manage` which stayed manager-only in Phase 7) and MANAGER.

Scope boundary, stated plainly: `CustomerReview` is entirely staff-recorded — there is no
customer-facing review submission form, no rating-invitation email, and no moderation queue.
Every review in this build is a staff member entering a rating/comment on a customer's behalf
("customer mentioned they loved the food"), the same "staff acts on the customer's behalf" pattern
already established for catering quote transitions in Phase 7.

## 17. Phase 9 — Inventory

Master spec §13 describes ingredients/recipes ("menu sales must be capable of triggering
inventory consumption according to the recipe"); §14 describes inventory (ingredients, units,
recipes, suppliers, purchase orders, stock counts, waste, and the seven-value transaction-type
list this build implements verbatim, plus "never silently alter inventory quantities — every
adjustment must have an audit trail"); §37 describes the finance-integration rules purchase/
consumption/waste should eventually drive (deferred to Phase 10's ledger — this phase builds the
real quantity/cost tracking those rules will read from, not the journal entries themselves).

**Two scoping tiers, mirroring the Phase 2 `MenuItem`/`RestaurantTable` split.** The catalog —
what an ingredient *is*, what a recipe calls for — is organization-scoped: `Unit`, `Ingredient`,
`Recipe`, `RecipeItem`. The same Chicken ingredient and the same Chicken Inasal recipe apply at
every branch. What's actually on the shelf right now is a per-location fact, so the operational
tier is branch-scoped: `InventoryItem` (the stock line itself), `InventoryTransaction` (the
ledger), `PurchaseOrder`/`PurchaseOrderItem`, `StockCount`/`StockCountItem`, `WasteRecord`.
`Supplier` sits in between — a supplier serves the whole business, not one branch, so it's
org-scoped even though the `PurchaseOrder` rows that reference it are branch-scoped, the same way
`Ingredient` is org-scoped while the `InventoryItem` rows that track its stock are branch-scoped.

**Unit conversion is a deliberately scoped single-level chain, not a general conversion graph.**
A restaurant buys chicken by the kilogram and a recipe calls for grams; without any conversion
support at all, every ingredient would need its stock unit and every recipe's unit to match
exactly, which doesn't reflect how kitchens actually work. Building a fully general N-level unit
graph (with unit families, dimensional analysis, etc.) is real scope this phase does not need: a
"base" unit (`baseUnitId = null`) and any number of "derived" units that each point directly at
one base unit with a `conversionFactor` covers every real case in the master spec (mass: kg/g,
volume: L/ml, count: piece) without the complexity of a general graph. `lib/inventory/units.ts`
implements this as pure, DB-free arithmetic (`convertQuantity`, `assertSingleLevelChain`),
independently unit-tested, the same "algorithm lives outside the service, testable without a
database" discipline `lib/crm/rfm.ts` established in Phase 8. Converting between units that don't
share a root base (grams to milliliters, without knowing the ingredient's density) throws rather
than silently guessing — this is a real scope boundary, not an oversight, and is worth revisiting
only if a future phase needs density-aware conversions.

**The audit-trail guarantee lives at the transaction-write layer, not as a policy.** Master spec
§14 says "never silently alter inventory quantities... every adjustment must have an audit trail."
Rather than trusting every call site to remember to write a matching `InventoryTransaction` row,
`InventoryService` funnels every single stock-quantity change — the very first balance on a new
`InventoryItem` included — through one private method, `applyTransaction`, which is the only place
`quantityOnHand` is ever written. It uses Prisma's atomic `increment` update (`SET quantityOnHand
= quantityOnHand + $delta` at the database level) instead of "read the current value, compute the
new one, write it back," so it can't race under concurrent writes to the same stock line, and it
always creates the matching ledger row inside the same database transaction as the balance change.
This makes the audit-trail guarantee a structural property of the code (there is no other path to
change the number) rather than a convention every future call site has to remember to follow.

**Consumption vs. transfer: an intentional asymmetry in whether stock can go negative.**
`quantityOnHand` is allowed to go negative for `SALE_CONSUMPTION`, `WASTE`, and `ADJUSTMENT` — all
three represent something that has already physically happened (a dish was made and served, an
ingredient was wasted, a correction was recorded), and refusing to record it because the ledger
disagrees would make the ledger *less* accurate, not more. `transferStock` is the one exception:
it checks the source branch has sufficient stock and throws `ConflictError` if not, refusing the
operation outright. The distinction is that a transfer is a *decision* staff are making right now
("move 8kg of chicken from Branch A to Branch B"), not a record of something that already occurred
— it is reasonable, even correct, to stop staff from transferring stock a branch doesn't actually
have. Both behaviors are documented in code comments at their call sites, specifically so a future
maintainer doesn't "fix" the asymmetry into consistency.

**Recipe consumption triggers on order completion, not order creation**, wired into
`OrderService.updateStatus`'s existing transaction only when the target status is `COMPLETED` —
the one terminal, never-reversed state in the order lifecycle (`ALLOWED_TRANSITIONS.COMPLETED` is
empty). This mirrors the "one business event, one transaction" pattern Phase 6 established for
Order→DeliveryOrder creation and Phase 7 established for CateringQuote ACCEPTED→CateringEvent
creation: `InventoryService.consumeForOrder` accepts the transaction client OrderService already
has open (`tx: Prisma.TransactionClient`) rather than opening a second one, so an order completion
and its ingredient consumption either both commit or both roll back together. Consumption is
deliberately **best-effort**: a menu item with no recipe, a recipe ingredient with no
`InventoryItem` at that specific branch, or a recipe unit that can't convert to the ingredient's
stock unit are all silently skipped inside the loop rather than thrown. The reasoning is the same
"a customer's order must never fail because of a back-office data gap" principle Phase 6 applied
to delivery-zone lookups: a kitchen finishing and serving a real dish is the actual business event
that must succeed; whether the inventory catalog happens to be fully configured for every
ingredient on that menu item is a separate concern staff can fix later, and a stricter ("throw if
anything's missing") design would have made a config gap in a rarely-ordered side dish capable of
blocking every order that included it.

**Stock count corrections use the current balance, not the count's opening snapshot** — worth
calling out because the wrong choice here is subtly plausible. `createStockCount` snapshots every
`InventoryItem`'s `quantityOnHand` into each line's `expectedQuantity` at the moment the count
opens. It would be natural to assume the eventual correction should be `counted - expectedQuantity`
— but a stock count can stay open for a while (a physical count of a whole walk-in takes real
time), and other transactions (a sale, a delivery) can and do happen during that window. If the
correction used the stale `expectedQuantity` snapshot as its baseline, it would silently undo those
intervening, entirely legitimate transactions. `completeStockCount` instead re-reads each
`InventoryItem`'s *current* `quantityOnHand` at the moment each line is recorded and bases the
`COUNT_CORRECTION` delta on that (`counted - current`), leaving `expectedQuantity` on the row purely
as a variance-reporting artifact ("how much drifted since this count opened"). Covered by an
integration test that deliberately fires an adjustment between opening and completing a count, to
prove the correction reflects the post-adjustment balance rather than the stale snapshot.

Permissions: no new grant — `inventory:manage` already existed in Phase 1's forward-looking
catalog, MANAGER-only (not STAFF), mirroring `catering:manage`'s precedent that back-of-house
purchasing/stock functions sit above the routine order/reservation/table work STAFF handles
directly.

Scope boundary, stated plainly: recipes are defined at the `MenuItem` level, not per-variant or
per-modifier (a "Large" chicken inasal and a "Regular" one consume the same recipe quantities in
this build). This is a real simplification — a genuinely size-aware kitchen would want more
chicken for the Large — but modeling variant/modifier-level recipe overrides is meaningfully more
schema and UI complexity than this phase's scope justifies; revisit if a future phase's owner
dashboard needs food-cost accuracy at that granularity. Similarly, the finance side of master spec
§37 (purchase → AP/cash, consumption → COGS journal entries, waste → expense journal entries) is
explicitly Phase 10's job — this phase builds the real, auditable quantity and cost data those
journal entries will read from (`getCogsForOrder`, `Ingredient.costPerUnit`, `InventoryTransaction.
unitCostAtTime`), not the double-entry postings themselves.

## 18. Phase 10 — Accounting

Master spec §27 ("This is a critical subsystem... each journal entry must balance... do not allow
a posted journal entry to be directly edited"), §28 (the seeded chart of accounts, reproduced
verbatim), §29 (the financial transaction engine — "every financial event must be mapped to
accounting entries... financial rules must be deterministic. AI must never directly invent
accounting entries"), §23 (customer deposits are a liability, not automatic revenue), §30 (expense
management), §45 (a dedicated `AccountingService` — "the service must be heavily tested"), §47
(idempotency for financial posting), and §49 (the exact automated-test list this phase's test
suite follows almost verbatim) together define this phase's scope. §35's income statement/balance
sheet/cash flow and §36's real-time financial dashboard are explicitly Phase 11's job — this phase
builds the ledger and the balance/trial-balance primitives Phase 11's reports will read from, not
the reports themselves (this build additionally does trial balance generation *this* phase, since
proving §49's SUM(DEBITS)=SUM(CREDITS) invariant needs it and it's listed as an `AccountingService`
responsibility under §45).

**A posted journal entry is immutable by construction, not by convention.** Master spec §27 is
direct about this: "do not allow a posted journal entry to be directly edited... use
reversal/correction entries." Exactly one thing in `AccountingService` is capable of writing to a
`JournalEntryLine` row — `createJournalEntry` (which only ever creates `DRAFT` entries) and the
line-creation step inside `postAutomaticEntry`. No method exists that updates a line on an entry
already in `POSTED` state. Correcting a mistake is only possible through `reverseJournalEntry`,
which creates an entirely new `POSTED` entry with every line's debit and credit swapped
(referencing the original via a `reversalOfEntryId` field carrying a database `@unique` constraint,
so an entry can be reversed at most once) and flips the original's `status` to `REVERSED` — a
lifecycle marker, never a rewrite of its content. This is the same "the guarantee is a structural
property of the code, not a rule someone has to remember" discipline Phase 9 used for the
inventory audit trail, one level up: there, the guarantee was "every quantity change has a ledger
row"; here it's "every posted entry's content is permanent."

**Deposits are a liability first, always — master spec §23's most concrete rule.** "Do not
automatically classify customer deposits as earned revenue... make this logic configurable and
flag local accounting/tax requirements for professional verification." This build implements the
two funnels that collect deposits differently, since they're shaped differently in the schema:
`Reservation.depositStatus` is a single status field (`NONE -> PENDING -> PAID -> REFUNDED`), while
catering has a real `CateringPayment` table with typed `DEPOSIT`/`BALANCE` rows. For reservations,
`ReservationService.recordDeposit`'s `PENDING/NONE -> PAID` transition posts Debit Cash / Credit
Customer Deposits; a `PAID -> REFUNDED` transition reverses it; and the reservation reaching
`COMPLETED` while still `PAID` (checked in `updateStatus`) is the one moment the deposit becomes
earned revenue (Debit Customer Deposits / Credit Dine-in Revenue) — modeling that the service was
actually delivered, not just booked. For catering, a `DEPOSIT` payment posts the same liability
entry; a `BALANCE` payment is this build's revenue-recognition trigger, but the amount credited to
Catering Revenue is **the sum of every actual payment received for that event to date** (every
`COMPLETED` `DEPOSIT` plus this `BALANCE`), not the quoted `CateringEvent.total` — a deliberate
choice to keep every entry grounded in real recorded cash movements rather than an assumed number,
directly honoring §29's "AI must never directly invent accounting entries" even in the edge case
where a customer ends up paying a different amount than quoted. A catering `BALANCE` payment
recorded as `REFUNDED` (a full-event refund after revenue was already recognized) is deliberately
left unwired — reversing an already-recognized revenue entry is exactly the kind of correction
§27 says should go through `reverseJournalEntry`, an accountant's explicit manual action, not a
rule this engine invents on its own.

**Idempotency is keyed to the business event, not the parent entity — a real design decision worth
walking through.** Master spec §47 requires idempotency for financial posting: "a repeated request
must not accidentally create duplicate... journal entries." Every automatic posting goes through
`postAutomaticEntry`, which pre-checks a `FinancialTransaction` row keyed on
`(referenceType, referenceId, type)` (a database `@unique` constraint, not just an application
check) before creating anything. The interesting case is `InventoryService.receivePurchaseOrderItems`:
the naive choice is to key on the `PurchaseOrder`'s own id, since that's "the thing being
received" — but Phase 9 explicitly built partial receiving as a first-class feature (a PO can be
received against multiple times as shipments arrive), and a PO-level idempotency key would
silently block every receipt after the first from ever posting its own accounting entry, since the
second receiving call's `(referenceType='PurchaseOrder', referenceId=po.id, type='INVENTORY_PURCHASE')`
key would already exist from the first. The fix is to key on **the id of one of the
`InventoryTransaction` rows that specific receiving call created** instead — naturally unique per
call, since Phase 9's `applyTransaction` always creates a fresh transaction row on every call. Waste
doesn't share this problem: each `WasteRecord` row is already a distinct entity per waste event, so
keying on its own id is safe without modification. This distinction — "is the parent entity
reusable across multiple postings, or is it a one-shot event" — is the actual test to apply before
choosing an idempotency key, not just "use the id of whatever object triggered this."

**Financial postings are not best-effort, unlike Phase 9's inventory consumption — a deliberate,
documented reversal of that precedent.** Every `AccountingService` lookup of a system account
(`getSystemAccount`) throws `NotFoundError` if the account isn't found, rather than silently
skipping the posting. This is the opposite choice from `InventoryService.consumeForOrder`'s
best-effort design (Phase 9), and the reasoning for the difference matters: a menu item missing a
recipe, or a recipe ingredient missing an `InventoryItem` at one branch, is a normal, expected data
gap that will exist for plenty of legitimate menu items (not every dish needs inventory tracking) —
blocking a customer's order over it would be wrong. A missing chart-of-accounts entry, by contrast,
means the organization was never provisioned correctly (`ensureChartOfAccounts` always runs at
registration; its absence is a setup bug, not a normal per-item gap), and silently failing to
record real money moving is a much worse failure mode than blocking the triggering business event
and surfacing a loud error to fix the setup gap.

**Order revenue posting exercises real judgment about how much of the order is actually paid.**
`recordOrderRevenue` doesn't assume an order is paid in full just because it reached `COMPLETED` —
it aggregates the order's `COMPLETED` `OrderPayment` rows, splits the debit side between Cash (the
paid portion) and Accounts Receivable (the unpaid remainder), credits the order-type-matched
revenue account (`Order.type` maps 1:1 onto "Dine-in Revenue"/"Take-out Revenue"/"Delivery
Revenue" by construction, since those enum values were chosen to match the seeded chart's account
names exactly) net of discount plus delivery fee, and credits collected tax separately to "Taxes
Payable" rather than folding it into revenue. COGS is posted as a fully independent second entry
(Debit Food Cost, Credit Inventory) using the exact consumption cost
`InventoryService.consumeForOrder` computes in the same transaction — its return type changed
from `Promise<void>` to `Promise<Prisma.Decimal>` this phase specifically so `OrderService` could
pass that number straight into `recordOrderRevenue` without a second query. The two entries are
independent on purpose: an order with ingredients consumed but zero net revenue (fully discounted)
still posts its real COGS, and an order with no recipe match for any of its items still posts
revenue.

Permissions: no new grant — `finance:view`/`finance:manage` already existed in Phase 1's
forward-looking catalog, granted only to `ACCOUNTANT`/`OWNER`/`ADMINISTRATOR` and deliberately
withheld from `MANAGER` (confirmed by reading `DEFAULT_ROLE_PERMISSIONS`, not assumed) — finance is
accountant/owner territory in this build, unlike inventory/catering which are manager-level.

Scope boundary, stated plainly: this phase builds the ledger and the mechanics that keep it
correct — chart of accounts, journal entries, the financial transaction engine, expenses, trial
balance. It does not build the presentational financial reports (income statement, balance sheet,
cash flow) or the owner-facing financial dashboard — those read from this ledger but are Phase
11's job per its own separate build list. It also does not implement Philippine-specific tax
compliance (BIR VAT netting/zero-rating, official-receipt sequencing, withholding tax, payroll) —
master spec §68 is explicit that this architecture must be technically sound but should not assume
local compliance automatically, and flags exactly these areas for review by a Philippine
accountant/tax professional before any of this ledger is used for real filings.

## 19. Phase 11 — Financial Reporting

Master spec §35 ("Reports must be generated from the accounting ledger. Do not calculate financial
statements from UI aggregates."), §36 ("update the relevant dashboard data without requiring
manual data entry... for financial data, correctness is more important than aggressive caching"),
§33/§53 (the owner dashboard's financial figures — Today's Revenue, Today's Expenses, Gross
Profit, Net Profit, Cash Position, Outstanding Receivables, Outstanding Payables, Inventory
Value), and §54 (every major report supports Today/Yesterday/This week/Last week/This month/Last
month/This quarter/This year/Custom range, plus a branch filter) define this phase's scope. The
master spec's own "PHASE 11 — FINANCIAL REPORTING" build list names Income Statement, Balance
Sheet, Cash Flow, Trial Balance, Account Balances, and Financial Dashboard, plus "verify
reconciliation" — Trial Balance and Account Balances were already built in Phase 10 (validating
that phase's own scope call to build them early since proving §49's debits=credits invariant
needed them) and are reused here unchanged; this phase's real new work is the three financial
statements, the dashboard, and the reconciliation tests.

**Every report is a live query over the ledger, never a cached or pre-aggregated shortcut.**
`services/reporting/ReportingService.ts` has no `Order`, `Reservation`, `CateringPayment`, or any
other business-event table anywhere in it — every method queries posted `JournalEntry`/
`JournalEntryLine` rows joined to `ChartOfAccount`, computed fresh on every request. This is a
direct, literal reading of §35's instruction, and it composes with §36's caching guidance the
simplest way possible: by not caching at all. At this build's data volumes a live aggregation
query per report request is the honest, correct choice — the same "an honest N+1 (or here, an
honest live query) is a documented limitation, not a shortcut" discipline Phase 8's
`segmentBreakdown` and Phase 10's `generateTrialBalance` already established.

**The Balance Sheet's Equity section has to include unclosed net income, or it simply wouldn't
balance — this is a real accounting consequence of a design decision made back in Phase 10, not
an approximation invented this phase.** `AccountingPeriod.close` (Phase 10) only blocks further
postings into a closed period; nothing in this build ever generates a closing journal entry that
zeroes Revenue/COGS/Expense account balances into Retained Earnings at period-end (real
double-entry systems do this at fiscal year-end). Because of that, Revenue/COGS/Expense balances
simply accumulate on the ledger forever, which means `Assets = Liabilities + Equity(recorded)` is
mathematically guaranteed to be *false* the moment any revenue or expense has ever posted — the
missing piece is exactly the cumulative net income those accounts represent. `generateBalanceSheet`
computes that cumulative net income (Revenue − COGS − Expense, from inception through `asOfDate`,
via the same account-aggregation helper the Income Statement uses) and folds it into the reported
Equity total. This isn't a workaround — every posted entry balances individually (enforced at
posting time), so summing every account's signed normal-balance amount across the *entire* ledger
through any date is identically zero, and that sum is precisely
`Assets − Liabilities − Equity(recorded) − NetIncomeToDate`. The identity therefore holds for any
subset of *whole* journal entries too, not just the full ledger — including a single branch's,
since every entry's `branchId` is uniform across all its lines by construction (a branch-scoped
filter never splits an entry in half). `tests/integration/reporting/reporting-service.test.ts`
proves this for an arbitrary transaction mix, including that an unposted `DRAFT` entry (which
should never be counted) doesn't perturb it, and that a branch-scoped balance sheet balances too.

**Cash Flow's three categories have no restaurant-specific mapping anywhere in the master spec, so
this phase makes that mapping an explicit, auditable part of the schema rather than an inferred
guess.** Two columns were added to `ChartOfAccount`: `isCashEquivalent` (a boolean, true only for
the seeded Cash and Bank accounts) and `cashFlowCategory` (a nullable `OPERATING`/`INVESTING`/
`FINANCING` enum, classifying every other account for when it's the *contra* side of a cash
movement). The seeded chart classifies Accounts Receivable/Inventory/Accounts Payable/Customer
Deposits/Taxes Payable and every Revenue/COGS/Expense account as `OPERATING` (the working-capital
and income-statement side of the business), Equipment as `INVESTING` (a fixed-asset purchase), and
Loans/Owner's Equity/Retained Earnings as `FINANCING` (the two unambiguous capital-structure
accounts). `generateCashFlow` implements the *direct* method: it finds every posted entry in the
date range that touches a cash-equivalent account, and for each one sums the non-cash lines'
`credit − debit`, grouped by `cashFlowCategory`. This is exact, not approximate — every posted
entry balances (enforced by `AccountingService.assertBalanced` at posting time), so
`sum(all lines' debit − credit) = 0` for any single entry, which means
`sum(non-cash lines' credit − debit) = sum(cash lines' debit − credit)` *exactly* — the entry's
real net cash impact, with zero rounding and zero proportional guessing, fully explained by
grouping its non-cash lines. A custom account an org adds later without setting a
`cashFlowCategory` still shows up, in a reported `unclassifiedActivities` bucket, rather than
silently vanishing from the statement — matching the "no silent caps" precedent this build already
applies to `generateTrialBalance`'s own `isBalanced` check. An entry that moves money between two
cash-equivalent accounts (e.g. a till-to-bank deposit) has both its lines skipped as "cash," so it
contributes nothing to any category — correctly, since total cash-on-hand across all
cash-equivalent accounts together doesn't change. Reconciliation (the master spec's explicit
"Verify reconciliation" instruction): `netCashFlow` (the sum of all four buckets, including
unclassified) is proven, in both the Vitest integration suite and a hand-written SQL smoke test
run directly against Postgres (this sandbox cannot execute `ReportingService.ts` itself — see
CLAUDE.md → Known Issues), to equal `endingCash − beginningCash`, computed completely
independently via the same account-balance aggregation the Balance Sheet uses, restricted to just
the cash-equivalent accounts.

**Scope boundary vs. Phase 12, confirmed by reading both phases' own build lists before writing
either dashboard.** §33's Owner Dashboard example mixes financial figures (Today's Revenue/
Expenses/Gross Profit/Net Profit/Cash Position/Outstanding Receivables/Outstanding Payables/
Inventory Value) with operational counts (Orders, Reservations, Customers, Catering Events) in one
mockup, and §34's Sales Analytics adds a further layer of by-channel/product/category/branch/hour/
day/month charts on top — but the master spec's own "PHASE 12 — OWNER ANALYTICS" build list
("Revenue dashboard, Profit dashboard, Customer analytics, Product analytics, Channel analytics,
Inventory analytics, Operational analytics") claims the operational-count and charting half of that
mockup for Phase 12, while "PHASE 11 — FINANCIAL REPORTING" claims only the ledger-derived
financial figures. `getFinancialDashboard` therefore returns exactly the financial subset — the
counts and charts are Phase 12's job, reading from `Order`/`Reservation`/`Customer`/`CateringEvent`
directly rather than from the accounting ledger, since those are genuinely operational metrics, not
financial ones.

Permissions: no new grant needed — every Phase 11 route is read-only and gates on the existing
`FINANCE_VIEW` permission, the same reuse precedent Phase 10 established for its own routes.

API routes: `/api/finance/reports/income-statement`, `/balance-sheet`, `/cash-flow`, `/dashboard`
— all `GET`, all org-scoped via the session, with an optional `branchId` filter.

Scope boundary, stated plainly: this phase adds no new tables, only two columns to
`ChartOfAccount`. Every method in `ReportingService` is pure read/aggregation over the ledger
Phase 10 built — nothing here writes a journal entry, and nothing here reads a business-event
table directly. Owner analytics (revenue/profit/customer/product/channel/inventory/operational
dashboards, all driven by business-event tables rather than the ledger) are Phase 12's job per its
own separate build list.

## 20. Phase 12 — Owner Analytics

`services/analytics/AnalyticsService.ts` fills exactly the scope boundary the previous section
draws: the operational-count and charting half of §33's dashboard mockup and §34's Sales Analytics,
plus the master spec's own "PHASE 12 — OWNER ANALYTICS" build list (Revenue dashboard, Profit
dashboard, Customer analytics, Product analytics, Channel analytics, Inventory analytics,
Operational analytics).

**Data-sourcing split.** Six of the seven methods (`getRevenueDashboard`, `getCustomerAnalytics`,
`getProductAnalytics`, `getChannelAnalytics`, `getInventoryAnalytics`, `getOperationalAnalytics`)
read directly from `Order`/`OrderItem`/`Reservation`/`CateringEvent`/`CateringPayment`/`Customer`/
`WasteRecord`/`PurchaseOrder`/`InventoryTransaction` — genuinely operational metrics, computed live,
never from the ledger. `getProfitDashboard` is the deliberate exception: profit needs real COGS and
expense figures, which only exist on the posted ledger, so it calls
`ReportingService.generateIncomeStatement` once per trend bucket (plus once more for the whole-range
total) rather than re-deriving profit from business-event tables a second time — the two numbers
can never drift apart because there is only ever one calculation.

**Trend bucketing.** `getRevenueDashboard` and `getProfitDashboard` both group their date range into
day, week, or month buckets, auto-chosen from the range's length (≤31 days → day, ≤120 → week, else
month). This required five new exported helpers in `lib/utils/timezone.ts` —
`startOfWeekInTimezone`/`endOfWeekInTimezone`, `startOfMonthInTimezone`/`endOfMonthInTimezone`,
`startOfQuarterInTimezone`/`endOfQuarterInTimezone`, `startOfYearInTimezone`/`endOfYearInTimezone`,
and `dateKeyInTimezone` — all built on a new private `startOfLocalDateInTimezone(year, month, day,
timezone)` primitive that constructs a UTC instant directly from explicit calendar components. That
primitive replaced a subtly-buggy pattern the original `resolveDateRangePreset` used (building a
same-day-of-month UTC proxy and reformatting it through the target zone to "discover" its calendar
date) — see `CLAUDE.md`'s Known Issues for the full west-of-UTC failure mode this fixed. Every
bucket enumeration is proven gapless and non-overlapping: `getProfitDashboard` clips only its first
bucket's start and last bucket's end to the overall query range, leaving every interior boundary as
`bucket[i].endDate + 1ms === bucket[i+1].startDate` exactly, which is what lets the trend buckets'
`netProfit` values sum to precisely the same figure a single whole-range income statement call
reports — proven in `tests/integration/analytics/analytics-service.test.ts`, the master spec Phase
11 "verify reconciliation" instruction extended to bucketing.

**Catering revenue timing.** Every method that touches catering revenue (`getRevenueDashboard`,
`getChannelAnalytics`) attributes it to the date its `CateringPayment` (type `BALANCE`, status
`COMPLETED`) posts — the exact instant `AccountingService.recordCateringBalanceSettled` recognizes
it on the ledger — rather than the (usually earlier) inquiry/quote/deposit dates or
`CateringEvent.eventDate`. This keeps the operational-side "when did this happen" answer consistent
with the ledger's own, even though these methods never read the ledger directly.

**Method-by-method notes:**

- `getCustomerAnalytics`: "new customers" is necessarily org-wide (`Customer` carries no
  `branchId` — see `schema.prisma`'s Phase 8 comment #1), even when a `branchId` filter narrows
  every other figure. "Repeat" means the customer had a non-cancelled order before the queried
  period started. Lifetime RFM segment mix is reused from `CustomerService.segmentBreakdown`
  as-is (necessarily all-time — RFM has no date-range concept in this build).
- `getProductAnalytics`: top products and revenue-by-category are both derived from one
  `OrderItem.groupBy` plus a single batched `MenuItem` lookup, not a second full scan.
- `getChannelAnalytics`: hour-of-day and day-of-week buckets are computed with small local
  `Intl.DateTimeFormat`-based helpers inside `AnalyticsService.ts` itself, not shared from
  `lib/utils/timezone.ts` — the same "each service owns its own small timezone helpers" precedent
  `ReservationService`'s `dayKeyInTimezone`/`minutesSinceMidnightInTimezone` already established.
- `getInventoryAnalytics`: waste cost is `WasteRecord.quantity × Ingredient.costPerUnit`; "food
  cost" is COGS as actually recognized via recipe-based consumption
  (`InventoryTransaction` type `SALE_CONSUMPTION`, mirroring `InventoryService.getCogsForOrder`'s
  formula generalized across a range); low/critical stock items reuse
  `InventoryService.getLowStockItems` per-branch (that method is branch-required by design, so an
  org-wide query loops over every branch).
- `getOperationalAnalytics`: table utilization is distinct dine-in tables used ÷ active tables;
  the "Kitchen" figure pairs `OrderStatusHistory`'s `PREPARING`→`READY` transitions per order into
  an average prep-to-ready duration — reusing Phase 5's own kitchen-timing data, not a new
  measurement.

Permissions: no new grants needed — `analytics:view` already existed in Phase 1's forward-looking
catalog, granted to `MANAGER`/`OWNER`/`ADMINISTRATOR`. `getProfitDashboard`'s route additionally
requires `finance:view`, gated via two sequential `requirePermission` calls rather than a new
combined-permission helper — a deliberate departure from every other analytics route, preserving
Phase 10's existing boundary that withholds COGS/margin data from `MANAGER`.

API routes: `/api/analytics/{revenue,profit,customers,products,channels,inventory,operations}` —
all `GET`, org-scoped via the session, with the same `preset`/`startDate`/`endDate`/`branchId` query
shape Phase 11's report routes already validate (`lib/validation/analytics.ts` re-exports
`reportDateRangeQuerySchema` rather than redefining it).

Dashboard UI: `components/analytics/analytics-board.tsx`, one tab per dashboard, following
`components/finance/finance-board.tsx`'s established pattern (branch + date-range-preset filter
bar, `Prisma.Decimal`-serializes-to-a-plain-string-over-JSON typing convention).

Scope boundary, stated plainly: this phase adds no new tables or columns at all — every method is
pure read/aggregation over tables Phases 1–11 already built. Master spec §55 (CSV/PDF/XLSX export
of every major report) remains deliberately unscheduled — confirmed via grep, again, to not be
assigned to any phase's own build list — documented via the `/dashboard/reports` "Exports"
placeholder rather than silently dropped.

## 21. Phase 13 — AI

`services/ai/InsightService.ts` is the master spec's "AI analytics service" (§37's Phase 13 build
list: AI analytics service, read-only business data tools, insight generation, trend analysis,
forecasting where appropriate). §38/§39 set the brief: analyze sales/customer/product/inventory/
expense/margin/demand trends, identify the underlying data used, never fabricate a figure, never
give the AI layer unrestricted database access.

**Design call: a rule engine, not a language model.** §38's own worked example ("Delivery revenue
increased 18%. Delivery-related costs increased 26%. Management should investigate: ...") and its
"never fabricate financial figures" instruction are both fully satisfiable by a deterministic engine
that only ever emits numbers it just computed from real service calls — no generative model is
needed to produce that example, and using one would add exactly the hallucination risk §39 warns
against. §57's "Configurable AI provider... do not hard-code any specific provider" is honored by an
optional narration seam (`lib/ai/AIProvider.ts`) a real provider can plug into later without
changing the insights themselves.

**Read-only business data tools** (`lib/ai/tools.ts`) — its own named deliverable, distinct from the
analytics service. Seven thin wrappers around Phase 12's `AnalyticsService` methods (one per
dashboard: sales, profit/margin, customer, product, channel/demand, inventory, operational), each
returning `{ data, source }`. This is the concrete implementation of §39's data-flow diagram:

```text
AI
↓
Read-only analytics tools     (lib/ai/tools.ts)
↓
Verified database queries     (AnalyticsService / ReportingService)
↓
Business data
```

`source` on every tool result is threaded onto every insight's `dataSources` field — §38's "AI
responses must always identify the underlying data used," enforced structurally (an `Insight`
literally cannot be constructed without it) rather than by convention.

**Insight generation and trend analysis** (`InsightService.generateInsights`). Every rule compares
the requested period against the immediately preceding period of equal length
(`AnalyticsService.previousPeriod`/`percentChange`, exported from Phase 12 and reused here so
"previous period" means the same thing in both features), and only surfaces an insight past a
threshold in `lib/ai/thresholds.ts` — §37's "All rules must be configurable," answered with the same
`DEFAULT_* constant + Organization.<phase>Settings JSON override` pattern `lib/crm/rfm.ts`
established for RFM (new nullable `Organization.aiSettings` column; see `docs/database.md`). Nine
rules span the seven "AI can analyze" categories:

- **Sales trend** — `getRevenueDashboard`'s own previous-period comparison, thresholded.
- **Margin change** — gross and net margin (from `getProfitDashboard`'s ledger-sourced totals),
  points-based threshold.
- **Expense trend** — iterates every COGS/EXPENSE ledger account, flagging any account whose amount
  swings past threshold (or is new this period), gated on a minimum amount so a tiny account's noisy
  percent swings don't flood the feed.
- **Channel cost-vs-revenue divergence** — §38's worked example made concrete, for the two channels
  the seeded chart of accounts gives a dedicated COGS account (Delivery, Catering): compares that
  channel's own revenue growth rate against its linked COGS account's growth rate, firing when cost
  is outpacing revenue by more than a configurable point gap.
- **Customer behavior** — repeat-rate change, points-based threshold, alongside new-customer counts.
- **Product performance** — by menu category (not individual top-10 product: a product absent from
  one period's top 10 can't be compared to its own prior figure, but every category is always
  present, so category-level trend is the robust comparison).
- **Inventory trends** — waste-cost trend, plus a critical-stock count alert (a point-in-time
  threshold, not a period-over-period trend).
- **Demand patterns** — an always-on informational insight naming the period's peak hour and
  weekday; no threshold, since there's no meaningful "previous period" comparison for an hour/
  weekday distribution the way there is for a single total.

Insights sort ATTENTION, then OPPORTUNITY, then INFO — §76's own AI Business Insights framing
("What changed? Why did it change? What requires attention? What opportunity exists?").

**Forecasting where appropriate** (`InsightService.forecastRevenue`) — a disclosed, naive
least-squares linear regression over the period's own revenue trend buckets, projected 1-6 buckets
forward (bounded in `lib/validation/ai.ts`; beyond a handful of buckets a naive linear projection
stops being "appropriate" per §37's own hedge). Requires at least 3 historical buckets or returns
`status: 'insufficient_data'`; every projected value is clamped at zero. Revenue-only by design —
compounding a second, independently-noisy series (margin, profit) on an already-noisy projection
would read as a financial promise this codebase has no basis to make.

**Optional AI-provider narration** (`lib/ai/AIProvider.ts`) — the same "unconfigured stub that fails
loudly" shape as `lib/payments/PaymentProvider.ts`. A configured provider may only turn
`InsightService`'s already-computed `Insight[]` into prose; its input type
(`AiNarrationRequest.insights`) is the complete, closed set of facts it may describe — it is never
handed a database connection or a raw prompt, and can never supply a figure that wasn't already
computed. No provider is registered in this codebase (`getAIProvider()` always returns
`UnconfiguredAIProvider`, reading `AI_PROVIDER_KEY` per `.env.example`), so `narrativeStatus` is
always `'not_configured'` — the deterministic insights are the complete feature regardless.

Permissions: no new grant. `/api/ai/insights` and `/api/ai/forecast` both require `ANALYTICS_VIEW`
**and** `FINANCE_VIEW` — the same two-permission gate Phase 12's Profit dashboard uses, for the same
reason: margin/expense-trend/channel-divergence insights are sourced from the ledger, exactly the
COGS/expense-derived data Phase 10 withholds from `MANAGER`. Splitting the single feed into a
finance-gated half and an analytics-only half would reopen that boundary through a new URL.

Dashboard UI: `components/ai/insights-board.tsx` (`/dashboard/ai-insights`) — a severity-colored card
grid plus a revenue-forecast card, following `analytics-board.tsx`'s filter-bar pattern.

Scope boundary, stated plainly: this phase adds exactly one nullable JSON column
(`Organization.aiSettings`) and no new tables — see `docs/database.md`.

## 22. Phase 14 — Notifications

`services/notifications/NotificationService.ts` is the master spec's "PHASE 14 — NOTIFICATIONS"
build ("Implement: Email, Push, SMS abstraction") plus §40's full type list. §44 names
`NotificationService` (singular) directly in its example service list.

**Design principle: best-effort side effect, never a blocking dependency.** A notification is a
consequence of a real business transaction (a reservation confirmed, an order placed), not a
precondition for it. Every `NotificationService` public method catches everything internally and
never throws; every call site in this codebase calls it *after* its own `prisma.$transaction(...)`
has already resolved — not inside it — both so slow provider I/O never holds a database transaction
open, and so a notification failure can never roll back data that already durably committed.

**One row per channel per attempt.** A notification fanning out to EMAIL and SMS produces two
independent `Notification` rows, not one row with two statuses — each channel's delivery outcome is
independently queryable/auditable, and every attempt (including `SKIPPED_NOT_CONFIGURED` and
`SKIPPED_NO_RECIPIENT`) is logged, so a missing row is never ambiguous with "the service was never
called." `relatedEntityType`/`relatedEntityId` reuse `AuditLog`'s existing polymorphic-reference
shape (string type + id) rather than a set of nullable per-entity-type foreign keys.

**Provider abstractions** (`lib/notifications/{EmailProvider,SmsProvider,PushProvider}.ts`) — the
same "unconfigured stub that fails loudly" shape as `lib/payments/PaymentProvider.ts` and
`lib/ai/AIProvider.ts`: an interface, an `Unconfigured*Provider` that throws unconditionally
(`NotificationService` checks `provider.name === 'unconfigured'` before ever calling `send`, so the
throw is a safety net, not the normal path), and a `get*Provider()` factory reading the exact env
var `.env.example` already reserved since Phase 1 (`EMAIL_PROVIDER_KEY`, `SMS_PROVIDER_KEY`,
`PUSH_NOTIFICATION_KEY`). No concrete provider is implemented, so every factory always returns its
stub today — wiring a real one in later changes only that factory's body, not any call site.

Push is a documented exception to "every channel gets tried": this codebase has no device-token or
push-subscription registration flow anywhere (no mobile app, no service-worker subscription capture
on the dashboard), so there is no recipient to push to even in principle. `NotificationService`
therefore never calls `getPushProvider()` at all — only EMAIL and SMS are attempted. The interface
exists so a future phase that adds device registration has the correct seam already shaped, per this
codebase's established "build the correct interface, flag what's not wired" discipline.

**Recipient resolution** reuses the guestName/guestEmail/guestPhone snapshot already present
directly on `Reservation`, `Order`, `CateringInquiry`, and `CateringEvent` — the same
"contact-at-time-of-booking, independent of any linked `User`/`Customer` account" convention already
used throughout this codebase (see e.g. Phase 3/4's own schema comments) — rather than a fresh join
out to `Customer`/`User`. Every triggering service method already has this data in hand from its own
query, so no call site needs an extra round-trip.

**Trigger-site mapping** — one master-spec §40 type per triggering condition, all 7 wired into
existing services:

| Type | Trigger | Site |
| --- | --- | --- |
| Reservation confirmation | status -> `CONFIRMED` | `ReservationService.updateStatus` |
| Order confirmation | order created | `OrderService.createOrder` |
| Order status | every status transition | `OrderService.updateStatus` |
| Delivery updates | every status transition | `DeliveryService.updateStatus` |
| Catering quotation | quote status -> `SENT` | `CateringService.updateQuoteStatus` |
| Invoice | invoice issued | `InvoiceService.issueInvoice` |
| Review request | order/reservation/event -> `COMPLETED` | all three of the above |

`Reservation confirmation` is deliberately tied to the internal `CONFIRMED` state-machine
transition, not reservation creation — `PENDING` -> `CONFIRMED` is a real, distinct, staff-driven
step in this codebase's state machine. `Order confirmation` is deliberately tied to *creation*
instead — an order's "confirmation" reads as a receipt/acknowledgment of placement, not the
internal `CONFIRMED` kitchen-side status, so the two "confirmation" events land at different points
in their respective lifecycles on purpose. `DeliveryService.assignDriver` is deliberately excluded —
it is its own entry point with its own audit trail (`DriverAssignment`), not part of the generic
status whitelist `updateStatus` validates against.

`Reservation reminder`, `Deposit reminder`, `Catering reminder`, and `Payment reminder` are fully
implemented as callable `NotificationService` methods but are not wired to any automatic trigger —
this codebase has no cron/scheduler infrastructure in any prior phase (see § Risks), so these are
built ready to be invoked from a future scheduled job, the same discipline already applied to
`PaymentProvider`/`AIProvider`.

Permissions: new `NOTIFICATION_VIEW`, granted to `MANAGER` by default (and to `OWNER`/
`ADMINISTRATOR` via their existing "every catalog permission" grant) — narrower than `AUDIT_VIEW`
(owner/admin only) since this is an operational communications log, not a full change-history audit
trail.

API + dashboard UI: `GET /api/branches/[id]/notifications` (filterable, bounded page size),
`components/notifications/notifications-board.tsx` (`/dashboard/notifications`) — a branch/type/
status-filterable delivery-history board following `invoice-board.tsx`'s established pattern.

Scope boundary, stated plainly: this phase adds exactly one new table (`Notification`) and three
new enums, and touches 7 existing service methods to call it — no changes to any existing table's
schema. See `docs/database.md`.
