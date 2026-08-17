# Restaurant Platform

Production restaurant management, booking, catering, ordering, CRM & financial intelligence
platform. See `CLAUDE.md` for the full architecture/status record and `docs/architecture.md` /
`docs/database.md` for details. This README covers local setup only.

**Status:** Phase 0 (discovery), Phase 1 (foundation: auth, RBAC, organizations, branches),
Phase 2 (restaurant configuration: tables, sections, business hours, menu, modifiers), Phase 3
(reservations: availability search, booking, deposits, status lifecycle, DB-enforced
double-booking prevention), Phase 4 (orders: dine-in/take-out/delivery, server-computed pricing,
status lifecycle, manual payment recording, sequential invoicing), Phase 5 (kitchen display:
live ticket board, required-time tracking), Phase 6 (delivery: zones, driver profiles,
dispatch/reassignment with a full audit trail, driver-scoped "my deliveries" view, delivery fee
folded into the order total), Phase 7 (catering: inquiry → quote → accept → deposit → event →
final payment funnel, server-computed quote totals, staff-recorded quote/event status lifecycle),
Phase 8 (CRM: customer profiles with addresses/preferences/notes/tags/reviews, lifetime-value
analytics, live-computed RFM segmentation with configurable thresholds, explicit customer linking
on orders/reservations/catering), Phase 9 (inventory: units with conversion, ingredients,
recipes linked to menu items, branch-scoped stock with a full transaction ledger, purchasing,
stock counts, waste, recipe-based consumption on order completion, COGS), and Phase 10
(accounting: seeded chart of accounts, double-entry journal entries with post/reverse, accounting
periods, a financial transaction engine automatically posting balanced entries for order
revenue/COGS, reservation and catering deposits, inventory purchases and waste, an
expense-approval flow, and a trial balance proving debits always equal credits), and Phase 11
(financial reporting: an income statement, a balance sheet that folds unclosed net income into
equity so it always balances, a direct-method cash flow statement, and an owner-facing financial
dashboard — every figure computed live from the posted ledger, never from UI aggregates), and
Phase 12 (owner analytics: revenue, profit, customer, product, channel, inventory, and
operational dashboards — six live-computed from Orders/Reservations/Catering/Inventory directly,
and Profit reusing Phase 11's income statement so it never disagrees with the ledger), and
Phase 13 (AI: a deterministic, template-based insight-generation engine — sales/margin/expense/
customer/product/inventory/demand trend detection over configurable thresholds, plus a disclosed
revenue forecast — reading only through read-only tools over Phase 12's own analytics, never given
database write access, with every insight naming the real data it came from) are implemented.
Everything else (notifications, hardening, deployment) is not built yet — see
`docs/architecture.md` for the phase order.

> **This code has not been runtime-verified.** It was authored in a sandbox with no network
> access to npm/pip, so `npm install` was never run here and nothing has been started, built, or
> tested. Follow the steps below in an environment with normal internet access before trusting it.

## Prerequisites

- Node.js ≥ 20
- PostgreSQL ≥ 14 (a local install or `docker run -p 5432:5432 -e POSTGRES_PASSWORD=devpassword postgres:16`)

## Install dependencies

```bash
npm install
```

## Configure environment

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL to your local Postgres, and generate AUTH_SECRET:
openssl rand -base64 48
```

## Start the database (if not already running)

```bash
createdb restaurant_platform
createdb restaurant_platform_test   # for integration tests
```

## Run migrations

```bash
npx prisma migrate dev
```

## Seed demo data

```bash
npm run db:seed
```

This creates one demo organization ("[DEMO] Manila Grill House"), two branches, one user per
role, 24 tables across 2 sections per branch, a starter menu (4 categories, 14 items, a variant,
and 2 modifier groups), 7 sample reservations spanning every status (pending, confirmed with a
paid deposit, seated, completed, cancelled, no-show), and 6 sample orders spanning every order
type and status (a fully-paid, invoiced dine-in order; a ready take-out order; a preparing
delivery order; a pending dine-in order; a cancelled take-out order; a confirmed dine-in order on
the second branch), including one issued invoice (`INV-000001`). Credentials are printed to the
console when the seed script runs — see `prisma/seed.ts`. All seeded records are clearly prefixed
`[DEMO]` and use `*.local` email addresses.

## Start the development server

```bash
npm run dev
```

Visit `http://localhost:3000` — you'll be redirected to `/login` (or `/register` to create a new
organization from scratch).

## Run tests

```bash
cp .env.test.example .env.test   # points integration tests at restaurant_platform_test
npm test              # unit + integration tests (Vitest)
npm run test:e2e      # end-to-end tests (Playwright) — starts the dev server automatically
```

## Other commands

```bash
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run build          # production build
npm run db:studio     # Prisma Studio (visual DB browser)
```

## Project layout

See `docs/architecture.md` § "Folder Structure" for the full target layout. Directories for
features not yet built contain a `.gitkeep` placeholder pointing back to their implementation
phase — this is intentional scaffolding, not missing files.
