# Restaurant Platform

Production restaurant management, booking, catering, ordering, CRM & financial intelligence
platform. See `CLAUDE.md` for the full architecture/status record and `docs/architecture.md` /
`docs/database.md` for details. This README covers local setup only.

**Status:** Phase 0 (discovery) and Phase 1 (foundation: auth, RBAC, organizations, branches) are
implemented. Everything else (reservations, orders, kitchen, delivery, catering, CRM, inventory,
accounting, reporting, analytics, AI, notifications) is not built yet — see `docs/architecture.md`
for the phase order.

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

This creates one demo organization ("[DEMO] Manila Grill House"), two branches, and one user per
role. Credentials are printed to the console when the seed script runs — see `prisma/seed.ts`.
All seeded records are clearly prefixed `[DEMO]` and use `*.local` email addresses.

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
