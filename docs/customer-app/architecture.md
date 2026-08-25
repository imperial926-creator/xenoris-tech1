# Customer Mobile App — Architecture & Decisions

This document is the "First Action" deliverable the customer-app master spec (`Customer Mobile App
for Restaurant.docx`, converted at project kickoff) requires before any production code: inspect
the existing repository, decide what to reuse vs. build new, and document the full target schema/
API/event contract before Phase 1 begins. It covers the **customer-facing white-label mobile app**
— a new, separate initiative layered on top of the existing staff-side `restaurant-platform`
(16 phases, complete — see root `CLAUDE.md`), not a replacement for it.

Throughout this document and the code, "CAPP" (Customer APP) prefixes anything specific to this
initiative — migration names, task list entries, doc files — to keep it clearly distinguishable
from the original platform's own Phase 1–16.

## 1. Inspection findings (spec §68, "First Action")

| Question | Finding |
|---|---|
| Does a restaurant management platform already exist? | Yes — `restaurant-platform` (this repo), 16 phases complete, staff-side dashboard only. |
| Technology stack | Next.js 14 App Router, TypeScript strict, Prisma 5 / PostgreSQL, Tailwind, Vitest + Playwright. |
| Database | PostgreSQL via Prisma. Already multi-tenant: `Organization` → `Branch` → everything else, every row carries `organizationId` (and `branchId` where applicable), enforced by convention (query scoping) plus Phase 15's defense-in-depth fixes. **`Organization` already IS the tenant boundary the spec calls "restaurant."** |
| API architecture | Next.js Route Handlers under `app/api/**`, Zod validation, service-layer business logic, `toErrorResponse` for consistent error shapes. Staff-only today (cookie session + RBAC). |
| Authentication | `lib/auth/session.ts` — HS256 JWT in an HttpOnly cookie, `lib/auth/password.ts` — bcrypt (cost 12), `lib/auth/rbac.ts` — DB-sourced permission checks. All staff-scoped (`User` model, org-scoped roles). **No customer-facing auth exists.** |
| Payment architecture | `lib/payments/PaymentProvider.ts` — provider-agnostic interface + throwing `UnconfiguredPaymentProvider` stub + `getPaymentProvider()` factory. No real provider wired in. Order/reservation/catering payments today are staff-recorded (manual "money changed hands" attestation), not customer-initiated online payment. |
| Real-time infrastructure | **None.** `KitchenBoard` uses interval polling (`POLL_INTERVAL_MS = 7000`) as an explicit, documented stand-in — "this build has no WebSocket/Pusher infra configured." No event bus, no outbox table, no SSE/WebSocket endpoint anywhere. |
| Notification infrastructure | `lib/notifications/{Email,Sms,Push}Provider.ts` — provider-agnostic stubs (Phase 14), `services/notifications/NotificationService.ts` — transactional notifications (reservation/order/delivery/catering/invoice status changes) as a best-effort side effect, never blocking. **This is transactional-only.** No campaign/audience/promotion/scheduling engine exists — that entire subsystem (spec §16–36) is net-new. |
| Existing `Customer` model | Yes — Phase 8 CRM added `Customer` (org-scoped CRM profile: name/email/phone/DOB, optional link to a staff `User` via `userId`), plus `CustomerAddress`, `CustomerPreference`, `CustomerNote`, `CustomerTag`, `CustomerReview`. These are **staff-managed guest records**, not self-service authenticated accounts — no password, no login. |
| Storage | `lib/storage/StorageProvider.ts` (Phase 16) — provider-agnostic stub, closes the seam for real uploads (e.g. restaurant logo/cover image, promotion images) once a provider is configured. |

**Conclusion:** the backend foundation (multi-tenancy, service-layer conventions, provider-agnostic
integration seams, audit logging, RBAC) is exactly what the spec asks for and gets fully reused.
What's net-new: customer-facing identity/auth, restaurant branding data, a public (non-staff) API
surface, real-time event delivery, and the entire promotions/campaigns/loyalty/notification-center
subsystem. No native mobile app exists in any form — it is built from scratch as a separate Expo
project (`/root/customer-app`) consuming this backend's new public API.

## 2. Reuse decisions

| Spec concept | Decision |
|---|---|
| `restaurant_id` (tenant key) | **`Organization.id`** (internal cuid) remains the real FK everywhere server-side — never duplicated into a parallel tenant model. A new `Organization.publicCode` (format `RST-000001`, sequential, unique) is the **customer-facing** identifier used in deep links, QR codes, and every `/api/v1/**` URL — chosen over exposing the internal cuid directly in public URLs as a small, free hardening (cuids aren't secret, but there's no reason to give them out either). Every `/api/v1/restaurants/:restaurantId/**` route resolves `publicCode → Organization.id` once, server-side, then proceeds exactly like existing tenant-scoped services. |
| `restaurants`, `restaurant_settings` | The existing `Organization` + `Branch` models — no duplicate "restaurant" table. `restaurant_settings` becomes a nullable `Organization.customerAppSettings Json?` field, same established pattern as `crmSettings`/`aiSettings` (Phases 8/13) — a JSON column code supplies defaults for, rather than a new table for a handful of not-yet-specified settings. |
| `restaurant_branding` | New `RestaurantBranding` model, 1:1 with `Organization` (see §3) — the spec explicitly names this as its own table (§40), and branding has a fundamentally different write pattern (rare, admin-only) than `Organization`'s core fields. |
| `customers` | The existing `Customer` model (Phase 8) — reused as-is, extended with one new nullable field (`customerAccountId`) linking it to the new self-service identity (see §4). All of `Customer`'s existing relations (orders, reservations, catering, addresses, preferences) are inherited for free. |
| `menus`, `menu_categories`, `menu_items`, `menu_modifiers`, `restaurant_tables` | Existing Phase 2 models (`MenuCategory`, `MenuItem`, `MenuItemVariant`, `MenuModifierGroup`, `MenuModifier`, `RestaurantTable`) — reused unchanged. The customer app reads them through new public, tenant-scoped GET endpoints; nothing about their shape changes. |
| `reservations`, `orders`, `order_items`, `delivery_orders`, `delivery_zones`, `catering_inquiries`, `catering_quotes` | Existing Phase 3/4/6/7 models and their services (`ReservationService`, `OrderService`, `DeliveryService` (folded into Order per Phase 6 — see `docs/architecture.md` § 14), `CateringService`) — reused unchanged. The customer app becomes a **second caller** of the same service layer the staff dashboard already calls, through new customer-scoped API routes (Phases 3–6 of this initiative — not built yet, see § 7). |
| `payments`, `payment_transactions`, `refunds` | Existing `OrderPayment`/`CateringPayment` models + `lib/payments/PaymentProvider.ts` — reused. Customer-initiated online payment (vs. today's staff-recorded manual payment) is new *call sites*, not a new payment data model. |
| `notifications` (transactional) | Existing `Notification` model + `NotificationService` (Phase 14) — reused for transactional customer notifications (order/reservation/payment/catering status). The spec's promotional/campaign notification system (§16–36) is additive, not a replacement — see § 5. |
| `audit_logs` | Existing `AuditLog` + `writeAuditLog()` — reused for every new mutating action (customer registration, promotion redemption, campaign send, etc.), same convention as every prior phase. |

## 3. New data model — Phase 1 scope (implemented this phase)

```
RestaurantBranding      (1:1 Organization)  — logo, cover image, colors, description, website,
                                               social links, reservation/cancellation/delivery policy
CustomerAccount                              — self-service platform identity (email/mobile/password,
                                               OAuth ids, profile photo, DOB, terms/privacy acceptance)
CustomerNotificationPreference (1:1 CustomerAccount) — promotional/order/reservation/loyalty/catering
                                               opt-ins, per-channel (email/SMS/push)
CustomerRefreshToken                         — one row per issued refresh token (device-scoped),
                                               enables "logout this device" vs. "logout all devices"
PlatformSequence                             — singleton counter backing Organization.publicCode
                                               generation (same atomic-increment pattern as InvoiceSequence)
RealtimeEvent                                — append-only outbox (see § 6); table lands this phase
                                               as schema only — see § 6's correction note and § 16
                                               for why the emit helper/SSE route/call sites this
                                               paragraph originally claimed shipped here did not
                                               actually exist until CAPP Phase 7
```

Plus: `Organization.publicCode` (new field), `Organization.customerAppSettings` (new nullable JSON
field), `Customer.customerAccountId` (new nullable field, unique, links a per-restaurant CRM
profile to the platform-wide login — mirrors the existing `Customer.userId` pattern exactly).

**Why a separate `CustomerAccount` instead of reusing `User`:** `User` is staff identity — it carries
org-scoped RBAC roles and permissions and is created only through staff invitation/registration
(`/register` creates an org *owner*). A customer's account is not scoped to one organization at
signup (per spec § 5's QR/deep-link discovery flow — one app install can be used across many
participating restaurants) and must never be reachable through any RBAC permission check. Keeping
them as two separate models with two separate auth/session modules (`lib/auth/*` unchanged for
staff, new `lib/customer-auth/*` for customers) makes "a customer can never accidentally get a
staff permission, and staff auth code can never accidentally trust a customer token" true by
construction, not by convention.

**Why `Customer.customerAccountId` is nullable and set lazily, not required:** the existing
`Customer` model already supports staff-entered walk-in guests with no account at all (dine-in
orders taken by a server, no self-service involved) — that must keep working unchanged. When a
`CustomerAccount` interacts with a given restaurant for the first time (books, orders, or is
recognized by matching email/phone against an existing staff-entered `Customer` row), a
`CustomerAccountService.getOrCreateCustomerProfile()` call either links the existing row or creates
a fresh one, scoped to that restaurant's `organizationId` — never merging data across restaurants.

**Why `CustomerRefreshToken` exists (access+refresh, not a single long-lived JWT):** the spec
requires "Secure sessions," "Logout," and explicitly "Logout all devices" (§ 7) — a stateless JWT
alone can't be individually revoked. Short-lived access tokens (JWT, ~15 min, unrevocable but low
blast-radius) plus a DB-tracked refresh token per device/session (revocable, powers both
single-device and all-device logout) is the standard pattern for this requirement, and mirrors the
spirit of the existing staff session design (HttpOnly-cookie JWT) without reusing its cookie
transport, which doesn't fit a mobile client the same way — see § 4.

## 4. Customer authentication

- **Transport:** mobile apps don't get reliable automatic cookie persistence across app restarts
  the way a browser does, and the spec's recommended stack (Expo/React Native) confirms a mobile
  client. Customer auth uses **bearer tokens** (`Authorization: Bearer <accessToken>`), issued by
  `/api/v1/auth/*` routes, stored client-side in Expo SecureStore (see `docs/customer-app/mobile.md`,
  written alongside the mobile scaffold) — not the staff dashboard's HttpOnly-cookie approach.
- **Access token:** short-lived (15 min) JWT, HS256, signed with a **separate** secret
  (`CUSTOMER_AUTH_SECRET`, new env var — deliberately not the same value as staff `AUTH_SECRET`, so
  a leak of one token type can never be replayed as the other) — carries `customerAccountId` only,
  no roles/permissions (customers have none).
- **Refresh token:** opaque random token, only its SHA-256 hash stored in `CustomerRefreshToken`
  (same "never store the verifiable secret itself" principle as `AUTH_SECRET` validation) — 30-day
  expiry, one row per login (device), `POST /api/v1/auth/refresh` rotates it (issues a new refresh
  token, revokes the old one — rotation-on-use, so a stolen-and-replayed old refresh token is
  detectable). `POST /api/v1/auth/logout` revokes one row (this device); a distinct
  `POST /api/v1/auth/logout-all` revokes every row for the account (spec § 7's "Logout all
  devices").
- **Password hashing:** reuses `lib/auth/password.ts` unchanged (bcrypt, cost 12, ≥8 chars) — no
  reason to duplicate this; it's identity-model-agnostic already.
- **OAuth (Google/Apple) and OTP:** reserved, unconfigured seams this phase, following the
  established `Unconfigured*Provider` pattern exactly (`lib/customer-auth/OAuthProvider.ts`,
  `lib/customer-auth/OtpProvider.ts`) — real interface, throwing stub, factory reading
  `GOOGLE_OAUTH_CLIENT_ID`/`APPLE_OAUTH_*`/`OTP_PROVIDER_KEY` (all reserved in `.env.example`, all
  unset). Email/password registration and login are the one real, working path this phase; wiring
  a real OAuth or OTP provider later is additive, not a redesign — same discipline as every other
  provider seam in this codebase.

## 5. Promotions, campaigns, loyalty, notification-center (schema preview — Phase 8/9 updates below)

Per spec § 68 item 13 ("create the database schema" before Phase 1 begins), the full target schema
for the promotions/campaigns/loyalty subsystem (spec § 16–41) is documented here so later phases
build against an already-agreed shape rather than improvising table names mid-phase.

**Update, CAPP Phase 8:** the `Promotion`/`PromotionCampaign`/`CampaignAudience`/`CustomerPromotion`/
`PromotionRedemption` tables below shipped this phase, close to (not identical to) this original
preview — see § 17 for the actual shape and every field-level deviation. `LoyaltyAccount`/
`LoyaltyTransaction`/`CustomerFavorite` still land in CAPP Phase 10, and `NotificationDelivery` in
CAPP Phase 9, per the phased plan in § 7, exactly like the base platform's own established
discipline of not building ahead of the phase that owns a feature.

**Update, CAPP Phase 9:** `NotificationDelivery` below shipped this phase, along with two tables
this original preview didn't anticipate — `CustomerPushToken` (device push-token registration) and
`CustomerNotification` (the actual notification-center inbox row; this preview only sketched the
per-channel delivery-tracking table, not the in-app entry itself) — see § 18 for the actual shape.
`LoyaltyAccount`/`LoyaltyTransaction`/`CustomerFavorite` still land in CAPP Phase 10.

**Update, CAPP Phase 10:** `LoyaltyAccount`/`LoyaltyTransaction`/`CustomerFavorite` below shipped
this phase, close to (not identical to) this original preview — see § 19 for the actual shape and
every field-level deviation (notably: `LoyaltyAccount` is keyed per `(organizationId,
customerAccountId)`, not the 1:1-per-account row sketched below; `tier` is stored, derived from
`lifetimePoints`, not computed on the fly from `pointsBalance`; `CustomerFavorite` unifies items and
orders into one XOR-column table, not the item-only shape sketched below). A new
`MenuItemRecommendation` table this original preview didn't anticipate also ships this phase (spec
§ 39 "Upselling" — staff-authored item-to-item suggestions, not a loyalty/favorites concept at all,
so it was never going to appear in this preview).

```
Promotion             — promotion_id (cuid), organizationId, title, description, imageUrl, promoCode,
                         discountType (enum — see below), discountValue, minimumOrderValue,
                         maximumDiscount, startAt, endAt, usageLimit, customerUsageLimit,
                         eligibleServices (Json — order types/reservation/catering),
                         eligibleMenuItemIds (String[]), eligibleCategoryIds (String[]),
                         status (DRAFT/SCHEDULED/ACTIVE/PAUSED/ENDED/CANCELLED), terms, createdAt, updatedAt
PromotionCampaign      — campaign_id, organizationId, promotionId, name, audienceType (enum, spec §19),
                         scheduledAt, status, createdAt
CampaignAudience       — campaign_id, customerAccountId, eligibilityStatus, createdAt
                         (materialized result of the audience-targeting query at send time —
                         auditable "who was actually eligible", not recomputed after the fact)
CustomerPromotion      — customerAccountId, organizationId, promotionId, status
                         (AVAILABLE/CLAIMED/REDEEMED/EXPIRED), claimedAt, redeemedAt
PromotionRedemption    — customerPromotionId, orderId/reservationId/cateringInquiryId (nullable,
                         whichever applies), discountAmount, redeemedAt — the authoritative,
                         append-only record backing promotion analytics/ROI (spec § 29–30)
LoyaltyAccount          (1:1 CustomerAccount per Organization) — pointsBalance, tier, createdAt
LoyaltyTransaction      — loyaltyAccountId, type (EARN/REDEEM/EXPIRE/ADJUST), points, relatedOrderId,
                         createdAt
CustomerFavorite       — customerAccountId, organizationId, menuItemId, createdAt
NotificationDelivery   — notificationId, channel (PUSH/EMAIL/SMS/IN_APP), status (spec § 34's
                         QUEUED/SENT/DELIVERED/OPENED/FAILED/UNSUBSCRIBED/BOUNCED), sentAt,
                         deliveredAt, openedAt, failedAt — per-channel delivery tracking, distinct
                         from the existing `Notification` model's single-row-per-attempt shape,
                         because a campaign notification fans out to multiple channels per customer
                         the same way `NotificationService.send()` already fans EMAIL/SMS out
                         independently (Phase 14) — this generalizes that same idea to PUSH/IN_APP
                         and adds the funnel-stage timestamps campaign analytics need.
```

`discount_type` enum: `PERCENTAGE`, `FIXED_AMOUNT`, `BOGO`, `FREE_ITEM`, `BUNDLE`, `FREE_DELIVERY`,
`FREE_ADDON`, `CATERING_DISCOUNT`, `RESERVATION_DISCOUNT`, `LOYALTY_REWARD`, `FIRST_ORDER`,
`REPEAT_CUSTOMER`, `BIRTHDAY`, `CUSTOMER_SPECIFIC` — matches spec § 18 exactly.

`audience_type` enum: `ALL`, `NEW`, `RETURNING`, `LOYAL`, `INACTIVE`, `ORDERED_ITEMS`,
`MADE_RESERVATIONS`, `ORDERED_DELIVERY`, `ORDERED_TAKEOUT`, `BOOKED_CATERING`, `INACTIVE_DAYS`,
`LOCATION`, `LOYALTY_TIER`, `SEGMENT` — matches spec § 19. The audience-resolution query for each
type is a read against existing data this platform already has (`Order`, `Reservation`,
`CateringInquiry`, the existing Phase 8 RFM segmentation in `lib/crm/rfm.ts`) — no new tracking
table is needed to answer "who ordered delivery in the last 30 days," which is exactly the kind of
reuse § 2 above is about.

## 6. Real-time architecture

**Decision: transactional outbox + Server-Sent Events (SSE), not WebSockets or a third-party
real-time service.** Reasoning:

- The spec's own recommended stack lists "WebSockets or managed real-time service" as an *option*,
  not a mandate, and explicitly prioritizes reusing existing infrastructure — this platform has
  none, and introducing a stateful WebSocket server (or a paid managed service requiring
  credentials this sandbox can't provision or verify) is a heavier, less provider-agnostic move
  than the spec's own §59-style "stay provider-agnostic" philosophy (established for payments/
  storage/AI in the base platform) calls for.
- Next.js Route Handlers can stream a `ReadableStream` response natively — this makes SSE
  deployable on the exact same infrastructure as everything else in this app (no separate process,
  no extra service to run/monitor/deploy), and is a real, standards-based mechanism (`EventSource`
  on web, a polyfill or `fetch` + streaming reader on React Native), not a fake stand-in.
- **Delivery mechanism:** every mutating service call that matters to the customer app (per spec
  § 15/§ 43's event list) writes a `RealtimeEvent` row (`organizationId`, `type`, `payload Json`,
  `createdAt`) in the **same DB transaction** as its primary write — the outbox pattern, chosen
  specifically so an event can never be "lost" by a network blip between the write committing and
  the event being published (a real risk with fire-and-forget in-process pub/sub). `GET
  /api/v1/restaurants/:restaurantId/events/stream` opens an SSE connection scoped to that
  organization and tails new `RealtimeEvent` rows via a short interval poll of the outbox table
  (same honestly-disclosed "polling under the hood, not Postgres `LISTEN/NOTIFY`" tradeoff the
  existing `KitchenBoard` already makes for the staff dashboard, chosen for the same reason:
  `LISTEN/NOTIFY` requires a held, dedicated DB connection per subscriber, which doesn't fit a
  serverless/autoscaled Next.js deployment target without a separate always-on process this build
  doesn't have). The **event still reaches the client as a real server-push** over the open SSE
  connection — only the outbox-to-SSE-process hand-off is poll-based, not the client-facing
  transport.
- **Event catalog:** exactly the list in spec § 43 (`ReservationCreated`, `OrderAccepted`,
  `PaymentConfirmed`, `PromotionStarted`, etc.) — `type` is a plain string, not a Prisma enum, so
  adding a new event type in a later phase never requires a migration.
- **Phasing:** the `RealtimeEvent` table lands in Phase 1 (this phase); wiring every mutation named
  in spec § 43 is CAPP Phase 7's dedicated job — see § 7 below.

  **Correction (written retroactively during CAPP Phase 7's own research — see § 16):** the
  paragraph above originally claimed Phase 1 also shipped "working infrastructure, proven with 2–3
  real emit call sites (customer registration, restaurant branding update)." That claim was false.
  A repo-wide search at the start of Phase 7 found no emit helper anywhere, no
  `prisma.realtimeEvent.create` call at any of the two named sites or anywhere else, and no SSE
  route — `RealtimeEvent` was schema with zero writers and zero readers from Phase 1 through the end
  of Phase 6. This is left here rather than quietly rewritten so the record stays honest about what
  actually happened: the design in this section was real and is exactly what Phase 7 built against,
  but its claimed proof-of-concept was not. See § 16 for the actual implementation.

## 7. Phased plan (spec § 62, adopted verbatim as the CAPP task list)

1. **Multi-tenant identity, branding, auth, DB, API** — *implemented, see § 10.*
2. **Restaurant profile, menu, menu availability sync** — *implemented, see § 11.*
3. **Reservations** — *implemented, see § 12.*
4. **Take-out: cart, checkout, payments** — *implemented, see § 13.*
5. **Delivery: addresses, zones, order tracking** — *implemented, see § 14.*
6. **Catering: inquiry, quotation, deposit, balance** — *implemented, see § 15.*
7. **Real-time synchronization (full event wiring across every mutation)** — *implemented, see § 16.*
8. **Promotions: engine, targeting, campaign management, redemption** — *implemented, see § 17.*
9. **Push/in-app notifications, notification center, anti-spam/opt-out** — *implemented, see § 18.*
10. **Loyalty, favorites, reordering, upselling** — *implemented, see § 19.*
11. **Analytics: promotion ROI, customer engagement, sales attribution** — *implemented, see § 20.*
12. Security, performance, testing, app-store submission prep, production deployment

Each phase, like the base platform's own 16, ends with tests + docs + a diagnostic-diff `tsc`
check + a commit, and is meant to be driven forward with an explicit "continue CAPP phase N"
request — the same workflow already established and validated across the base platform's 16
phases.

## 8. White-label rule (spec § 4, § 36, § 64) — how it's enforced, not just stated

Every customer-facing API response that includes restaurant-identifying data is derived from
`RestaurantBranding`/`Organization`/`Branch` at request time — there is no hard-coded restaurant
name, logo, color, or policy text anywhere in `app/api/v1/**` or the mobile app's screens. The
mobile app itself ships as one binary; branding is applied at runtime from whichever restaurant's
`publicCode` the customer is currently viewing (loaded via deep link, QR scan, or manual entry —
see `docs/customer-app/mobile.md`). This is enforced the same way Phase 1 of the base platform
enforced tenant isolation: by construction (every query takes `organizationId`/the resolved
`publicCode` as a required parameter), not by a lint rule or a promise.

## 9. What "done" means for this phase (spec § 67)

Per the spec's own Definition of Done, CAPP Phase 1 is not "the screens exist" — it requires DB +
API + auth + authorization + validation + error handling + tests + docs together, and that is
exactly what Phase 1 shipped: no mobile app existed yet at the end of Phase 1 (see § 11 below for
correction — an earlier draft of this section claimed login/register/home screens were already
built here; they were not. The mobile app itself, including those screens, is Phase 2's work).
Phase 1's Definition of Done is backend-only: DB schema, `/api/v1/auth/*`, customer identity/auth
service layer, tests, docs — all real, none mocked, nothing UI-facing yet. What Phase 1 did **not**
include (by the phased plan above, not by oversight): the mobile app itself, reservations/ordering/
delivery/catering/payments, promotions, loyalty, and real-time wiring — each has its own later
phase and its own Definition-of-Done pass.

## 10. Phase 1 implementation record

What was actually built, matching § 3–4 above:

- **Migration**: `prisma/migrations/20260818060000_capp_phase1_foundation/migration.sql` — hand
  -authored (same reason as every migration in this repo — no network access to run `prisma migrate
  dev`; see root `CLAUDE.md`). Additive only: two nullable columns on `organizations`/`customers`,
  five new tables, one new enum. Includes a backfill block that assigns `RST-000001`-style codes to
  any pre-existing organizations via the same `platform_sequences` counter new organizations use
  going forward.
- **Customer auth**: `lib/customer-auth/{constants,session,guard}.ts` — bearer access tokens (15 min
  TTL) signed with `CUSTOMER_AUTH_SECRET`, opaque rotating refresh tokens (30 day TTL, stored only
  as a SHA-256 hash, rotated on every use, individually or fully revocable). `OAuthProvider.ts` /
  `OtpProvider.ts` are unconfigured seams — email/password is the only working path this phase, per
  spec § 68's "do not fake integrations."
- **Services**: `services/customer/CustomerAccountService.ts` (register/login/refresh/logout/logout
  -all/`getOrCreateCustomerProfile`) and `services/customer/RestaurantDirectoryService.ts`
  (`allocatePublicCode` — the same upsert+increment pattern as `InvoiceService`'s invoice numbering
  — `getByPublicCode`, `getPublicMenu`, `upsertBranding`). `AuthService.register` now allocates a
  `publicCode` for every new organization in the same transaction as everything else it seeds.
- **API**: `app/api/v1/auth/{register,login,refresh,logout,logout-all}` and
  `app/api/v1/restaurants/[restaurantId]{,/menu}` — the latter two unauthenticated by design (a
  diner must see a restaurant's public menu before registering).
- **Validation**: `lib/validation/customer-auth.ts` (Zod). Registration requires email; mobile+OTP
  registration is deferred to whenever `OtpProvider` is configured, not a new migration.
- **Tests**: `tests/unit/customer-auth/session.test.ts` (token round-trip, tampering, bearer-header
  parsing, refresh-token hashing) and `tests/integration/customer/customer-account-service.test.ts`
  (register/login/refresh-rotation/logout/logout-all/profile-linking/public-code allocation,
  mirroring `tests/integration/auth/auth-service.test.ts`'s structure). `tests/helpers/db.ts` extended
  with the new tables in FK-safe order. Like every test in this repo, authored and TS-syntax-checked,
  not yet runtime-executed against a live Postgres (no network access in this sandbox — see below).
- **Env**: `CUSTOMER_AUTH_SECRET` added to `lib/config/env.ts`'s eagerly-validated required set
  (alongside `AUTH_SECRET` — there is no unconfigured fallback for signing tokens, unlike the
  provider-key vars) and to `.env.example`, `.github/workflows/ci.yml`, and
  `tests/unit/config/env.test.ts`.

**Verification**: `node_modules` does not exist in this sandbox (confirmed: no `package-lock.json`
was ever committed, `npm`/`prisma` registry access returns 403 — the same "no network access"
constraint documented for every phase of the base platform, see root `CLAUDE.md`). Full `tsc
--noEmit` type-checking is nonetheless possible here without `node_modules`, using the sandbox's
globally-installed TypeScript compiler (`6.0.3`) against this repo's own `tsconfig.json` — the same
diagnostic-diff methodology every phase of the base 16-phase build used (see root `CLAUDE.md`'s
per-phase verification notes). A baseline was captured before any CAPP code existed
(`/tmp/tsc_capp_baseline.txt`, 3,381 diagnostics — matches the number the base platform's Phase 16
shipped with exactly, confirming a clean starting point) and compared against the tree with all of
Phase 1's code added: 3,404 diagnostics, +23, zero new diagnostic categories, and every single new
diagnostic traces to one of Phase 1's own new files (missing-`node_modules` noise: unresolvable
`next/server`/`zod`/`jose`/`@prisma/client`/`vitest`/`server-only`/`process`/`crypto` types — the
identical pattern every prior phase hit, see e.g. § "TS-syntax-checked" notes throughout root
`CLAUDE.md`). One genuine, fixable type error surfaced and was fixed during this pass:
`extractBearerToken` in `lib/customer-auth/session.ts` returned `match[1]` directly, which
`noUncheckedIndexedAccess` (already enabled in this repo's `tsconfig.json`) types as
`string | undefined`, not assignable to the function's `string | null` return type — changed to
`match?.[1] ?? null`. No other existing file's diagnostic count changed, confirming Phase 1's
changes to `services/auth/AuthService.ts`, `lib/utils/api-error.ts`, and `lib/config/env.ts` didn't
regress anything already shipped.

As with every migration and every test in this repo's history, the migration SQL and the Prisma
schema changes are hand-verified against each other and against the established patterns they
mirror (`InvoiceSequence`, `Customer.userId`), but not executed against a live Postgres instance —
this sandbox has none. A future turn with real infrastructure access should run
`npx prisma migrate deploy && npm test` before this phase is considered fully proven, exactly as
root `CLAUDE.md` recommends for the base platform.

## 11. Phase 2 implementation record

Backend (`restaurant-platform`):

- **Business hours shared logic**: `lib/utils/business-hours.ts` — extracted from
  `ReservationService.assertWithinBusinessHours`'s private day-key/minutes-since-midnight helpers
  (not duplicated) so a new `isBranchOpenNow(branch, now)` can share them for a different question
  — "is it open right now" (spec § 8) vs. "does this requested booking time fall within hours".
  `ReservationService` now imports the same three primitives instead of defining its own; its own
  validation behavior is unchanged. `isBranchOpenNow` also handles hours that cross midnight (open
  18:00/close 02:00) correctly for a live "right now" check by also consulting yesterday's entry —
  something the booking-time validator deliberately doesn't need to (see both files' comments).
- **Restaurant profile enrichment**: `RestaurantDirectoryService.getByPublicCode` now also returns
  `location` (address/phone/timezone/openingHours/`isOpenNow`), sourced from what this decision
  documents as the organization's "primary" branch — see `resolvePrimaryBranch`'s comment for the
  full reasoning: this base platform allows multiple Branches per Organization, but the
  customer-app spec has no concept of a diner picking a location, so Phase 2 picks the
  longest-standing `ACTIVE` branch as the storefront the app represents. Covers this platform's own
  common case (one org, one branch) cleanly; a real branch/location picker is out of scope unless a
  future phase adds it — it isn't in the spec's own phase list.
- **Staff branding management**: new `branding:manage` permission (granted to `MANAGER` and
  `OWNER`/`ADMINISTRATOR` by default — same "operational setting, not core org identity" tier as
  `branch:manage`), `RestaurantDirectoryService.getBranding`/`upsertBranding` (now transactional
  and audit-logged), `lib/validation/branding.ts`, and `app/api/branding/route.ts` (GET/PATCH, no
  URL param — like every other "my own org's settings" route in this codebase, it only ever touches
  the caller's own `session.organizationId`).
- **Menu availability sync**: no schema or query changes were needed — `getPublicMenu`
  (Phase 1) was already a live, uncached query filtered to `active`/`available`, so an item a
  restaurant marks unavailable is already gone from the next `GET .../menu` call. This section
  exists to say so explicitly rather than leave "sync" undocumented: this is the honest
  "polling under the hood between outbox and SSE process, but real server-push over the open SSE
  connection to the client" distinction § 6 draws — right now it's just "not cached", full
  push-without-refresh is Phase 7's real-time wiring.
- **Seed data**: `prisma/seed.ts` now allocates the demo organization a `publicCode` (inline, not
  via importing `RestaurantDirectoryService` — seed.ts deliberately stays free of the `@/` path
  alias and `server-only` imports service files use, since it runs outside Next.js's module
  resolution) and seeds a demo `RestaurantBranding` row and weekly `openingHours` on both demo
  branches, so the customer-app endpoints have real, non-empty demo data to return.
- **Tests**: `tests/unit/utils/business-hours.test.ts` (day-key/minutes parsing, same-day windows,
  explicit closed days, administrative status override, overnight-window spillover both directions,
  missing-config defaults) and `tests/integration/customer/restaurant-directory-service.test.ts`
  (branding create/update/audit-log, `location`/`isOpenNow` via `getByPublicCode`, primary-branch
  selection). Same "authored and TS-syntax-checked, not yet runtime-executed" status as every test
  in this repo.

**Backend verification**: same `tsc --noEmit` diagnostic-diff methodology as Phase 1, against the
Phase 1 baseline this time (3,404 diagnostics — the number `docs/customer-app/architecture.md` § 10
recorded after Phase 1 landed). After Phase 2's backend changes: 3,411 diagnostics, +7, zero new
categories, every new diagnostic traces to Phase 2's own new files (`lib/utils/business-hours.ts`,
`lib/validation/branding.ts`, `app/api/branding/route.ts`, and the two new test files) — the same
missing-`node_modules` noise pattern as Phase 1. `services/reservations/ReservationService.ts`'s
diagnostic count is unchanged after its refactor to import the shared business-hours helpers
instead of defining its own, confirming that change didn't regress anything already shipped.

Mobile app — new sibling project `customer-app/` (see that project's own `README.md`):

- Hand-authored Expo/React Native + TypeScript scaffold (no `node_modules`/`npm install`, same
  network-access constraint as everywhere else in this sandbox — see that README's "Why
  hand-authored" section). React Navigation (stack + bottom tabs), Expo SecureStore for token
  persistence.
- **Real, working**: restaurant lookup by public code (manual entry — the QR/deep-link path needs
  production app-store identifiers this phase doesn't have, flagged not faked), registration,
  login, session persistence + transparent access-token refresh (`AuthContext.tsx`), the Restaurant
  Home Screen (branding, live OPEN/CLOSED, address, hours, primary actions), and the Menu screen
  (categories/items/variants/modifier groups, refetched on every visit for the "not cached" sync
  story above).
- **Honestly stubbed, not faked**: Promotions/Orders/Reservations tabs render a
  `ComingSoonScreen` naming which later CAPP phase builds them, matching this project's
  "flag rather than silently skip" convention.
- **Verification**: this sandbox has no React Native runtime/simulator to actually launch the app,
  so verification is the same `tsc --noEmit`-against-a-hand-authored-tsconfig approach as the
  backend, adapted for a project with zero prior baseline (nothing to diff against — it didn't
  exist before this phase). Every diagnostic was individually reviewed rather than diffed: the
  majority are the same missing-`node_modules` module-resolution noise as the backend, plus one
  Expo/React-Native-specific variant worth naming — with `@types/react` unresolvable, JSX's
  implicit "children prop" merging isn't available, so any component with a required `children`
  prop (e.g. `Screen.tsx`) reports `TS2741: Property 'children' is missing` at every call site; this
  disappears entirely once real React types resolve, exactly like the backend's own
  `TS7026`/JSX-`any` findings. Two **real** bugs were found and fixed in this pass, both from
  `noUncheckedIndexedAccess` (already enabled, matching the backend's `tsconfig.json`):
  `RestaurantHomeScreen.tsx` read a possibly-`undefined` array/record index without narrowing
  (fixed with an explicit `if (!entry) return null` instead of a non-null assertion), and
  `MenuScreen.tsx` passed `key` to a separately-typed child component's props (`MenuItemRow`) —
  the exact same "JSX `key` prop on a separately-typed component" issue the base platform's Phase 5
  hit and documented in root `CLAUDE.md`; fixed the same way that precedent recommends in spirit
  (avoid passing `key` to the strictly-typed component), here by wrapping in a keyed `<View>` rather
  than fully inlining, since `View`'s own prop type is unresolvable and doesn't enforce this check.

## 12. Phase 3 implementation record — Reservations (spec § 10)

**Why this isn't just the staff reservation flow with a URL prefix**: the staff-facing
`createReservationSchema`/`ReservationService.createReservation` require an explicit `tableIds`
pick — appropriate for a host standing at a floor plan, wrong for a diner. Spec § 10's flow is
date, time, guest count, an optional "preferred seating where available" (a soft preference, not a
table id), and an optional special request — nothing about which physical table. Phase 3 therefore
adds a customer-facing entry point that auto-assigns table(s) and reuses the staff path's actual
booking transaction underneath, rather than a parallel booking pipeline duplicating the
double-booking-safe machinery.

Backend (`restaurant-platform`):

- **`lib/utils/table-assignment.ts`** (new, pure, zero Prisma/framework dependency) —
  `selectTables(tables, guestCount, seatingPreference)`: picks the smallest single table that fits,
  or — if none is big enough — the smallest greedy combination, sorted ascending by capacity (the
  same order `ReservationService.findAvailableTables` already returns). The seating preference is
  tried first as a filter against `TableSection.name` and only silently widened to the full table
  list if that subset can't seat the party; the result's `preferenceHonored` flag tells the caller
  which actually happened, so nothing is faked or hidden from the diner (spec's dev principles:
  "Do not fake reservation availability"). Extracted as a standalone module — not a private method
  on the new service — for the same reason `business-hours.ts` was extracted in Phase 2: it's the
  one piece of this phase's logic testable without a live Postgres connection in this sandbox.
- **`services/customer/CustomerReservationService.ts`** (new) — `checkAvailability` (live
  availability + the distinct seating types currently open, for the booking form's preference
  picker), `createReservation` (resolves the storefront via `RestaurantDirectoryService`, links/
  creates the diner's `Customer` CRM row via `CustomerAccountService.getOrCreateCustomerProfile`,
  auto-assigns tables, then calls the existing `ReservationService.createReservation` transaction),
  `list`/`get` (the diner's own reservation history — spec § 1 item 19 — scoped to their `Customer`
  row, 404s rather than 403s on someone else's reservation id so existence is never leaked).
- **Two small, deliberate widenings to existing Phase 1/2/3-base code**, both documented in place
  rather than worked around:
  - `RestaurantDirectoryService.resolvePrimaryBranch` went from `private` to a plain `static` —
    reservations need the actual `branchId` (tables are branch-scoped), not just the address/hours
    fields `getByPublicCode` projects out of it.
  - `ReservationService.createReservation`'s `actorUserId` parameter widened from `string` to
    `string | null`, for customer-initiated bookings where there is no staff `User` doing the
    creating. This mattered more than it sounds: `AuditLog.userId` has a real FK to `User`, so a
    `CustomerAccount` id must never be written there — passing `null` is the honest choice, not a
    shortcut. `CustomerReservationService.createReservation` separately writes its own
    `reservation.customer_create` audit entry (no `userId` column involved) recording the
    `customerAccountId`/`customerId`/seating-preference outcome in the JSON `newValue`, so the
    "which CustomerAccount made this booking" trail still exists — just not through a column that
    would either violate the constraint or risk misattributing the booking to an unrelated staff
    `User` that happens to share the same id.
- **`CustomerAccountService.findCustomerProfile`** (new) — the read-only counterpart to
  `getOrCreateCustomerProfile`: "view my reservations" must never conjure a `Customer` CRM row (an
  audit-logged write) into existence just because a diner opened the tab. Returns `null` for "never
  booked here yet", which `CustomerReservationService.list`/`get` treat as a genuinely empty result,
  not an error.
- **Routes** — `app/api/v1/restaurants/[restaurantId]/reservations/availability` (GET, public/
  unauthenticated, same posture as `.../menu`: a diner can check availability before registering),
  `.../reservations` (GET own history / POST create, both bearer-auth gated via
  `requireCustomerAuthenticated`), `.../reservations/[reservationId]` (GET single detail, same
  auth). `lib/validation/customer-reservation.ts` defines the customer-facing schemas — no
  `tableIds`, `guestName`, `guestEmail`, or `guestPhone` fields exist on them at all (contact info
  is sourced server-side from the authenticated profile; a diner cannot book "as" someone else).
- **Tests**: `tests/unit/utils/table-assignment.test.ts` (single-table fit, multi-table combination,
  unseatable party, preference honored / preference unavailable-so-falls-back / preference matches
  but can't fit the party / tables with no section), `tests/unit/customer-reservations/validation.test.ts`
  (schema defaults, confirms `tableIds`/`guestName`/`guestEmail` are genuinely absent from parsed
  output even if supplied), `tests/integration/customer/customer-reservation-service.test.ts`
  (auto-assignment picks the smallest sufficient table, links/creates the `Customer` row, honors a
  matching seating preference end-to-end, rejects an unseatable party with `ConflictError`, `list`
  stays empty with no side-effect row for a diner who's never booked, ownership scoping on
  `list`/`get`). Same "authored and TS-syntax-checked, not yet runtime-executed" status as every
  other test in this repo (no Postgres/`node_modules` in this sandbox — see root `CLAUDE.md`).

**Backend verification**: same `tsc --noEmit` diagnostic-diff methodology as Phases 1-2, against the
Phase 2 baseline (3,411 diagnostics). After Phase 3: 3,422, +11, zero new categories — every new
line traces to Phase 3's own new files (the three new routes, `lib/validation/customer-reservation.ts`,
`CustomerReservationService.ts`, and the three new test files) and fits the established
missing-`node_modules` noise pattern (`TS2307` module-not-found for `next/server`/`zod`/`vitest`,
`TS2882` `server-only` side-effect import, `TS7006` implicit-any from an unresolved Prisma-typed
array method, `TS2591` missing `process`). `lib/utils/table-assignment.ts` — the one new file with
zero external dependencies — contributes **zero** new diagnostics on its own, a useful signal that
its type surface (the `AssignableTable`/`TableAssignment` interfaces, the algorithm itself) is
actually sound rather than coincidentally quiet. Two pre-existing diagnostics
(`services/customer/RestaurantDirectoryService.ts`, `services/reservations/ReservationService.ts`)
shifted line numbers only, from this phase's added comments — same diagnostics, not new ones. One
diagnostic's displayed union-member order changed (`AuthService.ts:91`, untouched by this phase) —
compiler-internal, not a semantic change; same file/line/rule before and after.

Mobile app (`customer-app/`):

- **Real, working**: the Reservations tab (`src/screens/reservations/ReservationsScreen.tsx`)
  replaces its Phase 2 `ComingSoonScreen` stub entirely. Logged out: the same login/register-in-place
  pattern `ProfileScreen.tsx` established (booking is tied to a `CustomerAccount`, so there's no
  browsing-without-an-account path here the way Menu has). Logged in: a "New reservation" form
  (date/time as plain text fields — see below — guest-count stepper, optional seating preference
  with tappable chips populated from a live "Check availability" call, optional special request)
  and a "My reservations" history list, matching spec § 10 and § 1 item 19 exactly — no table
  picker anywhere in the UI, because table assignment is entirely the backend's job.
  `src/utils/reservationDate.ts` combines the separate date/time fields into the ISO string the
  backend expects, with explicit rejection of JS's own date-overflow rollover (e.g. "2026-02-30"
  silently becoming March 2nd).
- **Honest simplification, flagged not faked**: this project has no date/time-picker dependency —
  `package.json` only lists what's actually installable in this sandbox's `node_modules`-less build
  (see `customer-app/README.md`'s "hand-authored, not create-expo-app" section), so the booking form
  uses plain `YYYY-MM-DD`/`HH:MM` text fields instead of a native picker, and parses them as the
  *device's* local wall-clock time rather than converting through the restaurant branch's timezone.
  Documented in `reservationDate.ts` itself as a real limitation, not silently glossed over — a
  proper timezone-aware picker is a natural follow-up once a picker dependency can actually be
  installed in a real build environment.
- **API client**: `getReservationAvailability` (public, mirrors `getRestaurant`/`getRestaurantMenu`)
  lives in `src/api/client.ts`; booking, history, and detail calls go through `useAuth().authorizedFetch`
  directly from the screen rather than new stateless wrapper functions, per `AuthContext.tsx`'s own
  header comment that authenticated screens should use `authorizedFetch` (only it knows the current
  token and how to refresh it on a 401) — `logoutAllCustomerDevices` remains the one exception,
  since it's part of the auth flow itself, not a screen.
- **Verification**: `tsc --noEmit` diagnostic-diff against the Phase 2 baseline (47 diagnostics —
  freshly regenerated from the Phase 2 commit via `git stash`, since the number is small enough that
  redoing it exactly is cheap and more trustworthy than reusing a possibly-stale cached figure).
  After Phase 3: 56, +9, zero new categories, every new line traces to
  `ReservationsScreen.tsx` and fits the same patterns Phase 2 already established and documented
  (`TS2307` for `react`/`react-native`, `TS2741` "children" on `Screen`, `TS7006` implicit-any
  cascading from `useState`'s own type being unresolvable without `react`'s types). One pre-existing
  diagnostic (`src/api/client.ts`) shifted one line from this phase's added import — same diagnostic,
  not new. `src/utils/reservationDate.ts` — the other new file with no React Native/Expo dependency —
  contributes zero new diagnostics on its own, same signal as the backend's `table-assignment.ts`.
- No test runner exists yet for this project (`package.json`'s `"test": "jest"` script has no
  `jest.config`/fixtures behind it — that gap predates this phase, from Phase 1/2's own scaffold).
  Setting one up is out of scope for "continue CAPP phase 3" and left for whichever phase actually
  needs it, rather than bolted on here as an unrelated side quest.

## 13. Phase 4 implementation record — Take-out: cart, checkout, payments (spec § 11)

**Scope decision**: strictly `type: 'TAKEOUT'`, matching the phased plan's own title. `Order` also
supports `DINE_IN`/`DELIVERY`, but those belong to a diner already seated (no numbered phase in the
spec's § 62 sequence covers ordering from the table) and Phase 5 respectively — flagged as
deliberately out of scope here rather than silently bundled in. `RestaurantHomeScreen`'s existing
Delivery/Catering buttons still route to the same "Orders" tab they did before this phase (unchanged
from Phase 2) — that tab now does something real for take-out specifically, not yet distinguished by
order type; a real delivery/catering entry point is that phase's own work, not retrofitted here.

**Payments**: the spec's dev principles are explicit — "Do not fake payments" and "Do not claim ...
a payment is successful until the backend has verified it" — and `lib/payments/PaymentProvider.ts`
(Phase 4 on the base platform's own 16-phase track) is a deliberately unimplemented seam. So checkout
never creates an `OrderPayment` row with `status: 'COMPLETED'`: the diner's chosen method is recorded
at `status: 'PENDING'` — real, useful data for staff ("this customer intends to pay via GCash") without
ever claiming money moved. The mobile checkout screen says so explicitly ("no online payment gateway
is connected yet ... settled at pickup"), not just in code comments.

Backend (`restaurant-platform`):

- **`services/customer/CustomerOrderService.ts`** (new) — `createOrder` (resolves the storefront,
  links/creates the diner's `Customer` CRM row, parses and validates the required pickup time — a
  5-minute past-time grace window mirroring `ReservationService.createReservation`'s, plus a
  business-hours check reusing Phase 2's `isBranchOpenNow` primitive for a single-instant read rather
  than `ReservationService.assertWithinBusinessHours`'s start/end-window logic, which a pickup time
  doesn't need — then calls the existing `OrderService.createOrder` transaction, followed by
  `OrderService.recordPayment` at `status: 'PENDING'` for the stated payment method), `list`/`get`
  (the diner's own take-out order history — spec § 1 item 18 — scoped to their `Customer` row, same
  404-not-403 ownership posture as `CustomerReservationService`).
- **`OrderService.createOrder`/`recordPayment`'s `actorUserId` widened to `string | null`** — the
  exact same widening and the exact same reason `ReservationService.createReservation` got in Phase 3
  (a `CustomerAccount` id must never be written to `AuditLog.userId`, a real FK to `User`).
  `CustomerOrderService` passes `null` and writes its own `order.customer_create` audit entry
  separately, recording `customerAccountId`/`customerId`/`paymentMethod` in the JSON `newValue`.
- **`OrderService.ORDER_INCLUDE` exported** (was module-private) so `CustomerOrderService.list`/`get`
  read the exact same `{items, payments, table, delivery}` shape the staff dashboard sees, rather
  than a second hand-maintained include that could drift from it.
- **`RestaurantDirectoryService.resolveStorefront`** (new, shared) — the `publicCode ->
  {organizationId, branchId}` resolution `CustomerReservationService` had as a private method in
  Phase 3 is now a `RestaurantDirectoryService` method both customer services call, rather than a
  third near-identical copy landing here. `CustomerReservationService` keeps a one-line private
  pass-through of the same name so its four existing call sites didn't need touching.
- **Routes** — `app/api/v1/restaurants/[restaurantId]/orders` (GET own history / POST create) and
  `.../orders/[orderId]` (GET detail), both bearer-auth gated. No public "check availability" route
  the way reservations has one — the menu itself is already public (Phase 2), so there's nothing
  further to check before checkout beyond what `OrderService.createOrder`'s own item/modifier
  validation already does authoritatively.
- **`lib/validation/customer-order.ts`** — reuses `orderItemInputSchema` from the staff schema
  directly, unmodified (it already had no staff-only fields to strip). `customerCreateOrderSchema`
  itself has no `type`, `tableId`, `deliveryAddress`/`deliveryZoneId`, or guest-contact fields at
  all, same "server-resolved identity, never free text" rule `customer-reservation.ts` established.
- **Tests**: `tests/unit/customer-orders/validation.test.ts` (schema defaults, confirms `type`/
  `tableId`/`guestName`/`discountAmount` are genuinely absent from parsed output even if supplied),
  `tests/integration/customer/customer-order-service.test.ts` (server-computed pricing end-to-end,
  the payment record is created at `PENDING` and never `COMPLETED`, links/creates the `Customer` row,
  rejects a past pickup time, rejects a pickup time outside configured business hours, `list` stays
  empty with no side-effect row for a diner who's never ordered, ownership scoping on `list`/`get`).
  Same "authored and TS-syntax-checked, not yet runtime-executed" status as every other test here.

**Backend verification**: `tsc --noEmit` diagnostic-diff against the Phase 3 baseline (3,422). After
Phase 4: 3,429, +7, zero new categories — every new line traces to this phase's own new files (the
two new routes, `lib/validation/customer-order.ts`, `CustomerOrderService.ts`, and the two new test
files) and fits the established missing-`node_modules` noise pattern. `RestaurantDirectoryService.ts`
and `OrderService.ts` each show only line-number-shifted pre-existing diagnostics from this phase's
added comments — not new ones.

Mobile app (`customer-app/`):

- **Real, working**: `src/cart/CartContext.tsx` (in-memory cart state, cleared automatically when the
  selected restaurant changes — a cart built from one restaurant's menu is meaningless at another's
  `/orders` endpoint), `src/screens/menu/ItemCustomizationModal.tsx` (variant/modifier/quantity/
  special-instructions picker opened by tapping a menu item — client-side required/minSelect/
  maxSelect enforcement is a UX convenience only, the backend re-validates authoritatively regardless),
  and `src/screens/orders/OrdersScreen.tsx` (replaces the Orders tab's `ComingSoonScreen` stub
  entirely: a Cart/Order-history toggle, cart line editing, pickup date/time fields reusing Phase 3's
  `reservationDate.ts`, a payment-method chip picker with the same "settled at pickup" honesty the
  backend enforces, and order history). `MenuScreen.tsx` gained a floating "View cart" bar and
  per-item tap-to-customize; `App.tsx` now wraps the tree in `CartProvider` alongside `AuthProvider`/
  `RestaurantProvider`.
- **`src/utils/money.ts`** (new) — cents-based arithmetic for the cart's running-total display only
  (never sent to the server; `OrderService.createOrder` recomputes the authoritative total from
  scratch, "never trust a client-submitted total" — same principle the backend docs already state).
  Converts decimal strings to integer cents before summing, avoiding the floating-point drift plain
  string-to-float arithmetic would introduce.
- **Two real bugs found and fixed in this pass**, both the same "JSX `key` prop on a
  separately-typed component" issue Phase 2's `MenuItemRow` and the base platform's Phase 5 already
  hit and documented: `ItemCustomizationModal`'s `SelectRow` (two call sites — variants and
  modifiers) and `OrdersScreen`'s `CartRow` all had `key` passed directly to a strictly-typed child
  component; fixed the same way precedent recommends, wrapping each in a keyed `<View>` instead.
- **Verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 3 baseline (56
  diagnostics, confirmed via `git stash` against the Phase 3 commit rather than trusting a possibly
  stale cached figure). After Phase 4: 94, +38, zero new categories — every new line traces to this
  phase's own new/changed files and fits the same patterns Phase 2/3 already established (`TS2307`
  for unresolved `react`/`react-native`/`@react-navigation/*`, `TS2741` "children" on `Screen`,
  `TS7006`/`TS7053` implicit-any cascading from `useState`'s own type being unresolvable without
  `react`'s types — the `TS7053` on `OrdersScreen`'s `PAYMENT_METHOD_LABELS[paymentMethod]` lookup is
  the same category as the backend's pre-existing `AuthService.ts:91` quirk, not a new one).
  `src/utils/money.ts` — the one new file with zero React/React Native dependency — contributes zero
  new diagnostics on its own, same signal Phase 3's `reservationDate.ts`/`table-assignment.ts` gave.
- Same no-test-runner gap as Phase 3 (`package.json`'s `jest` script has no config behind it) —
  still out of scope for this phase, not bolted on as a side quest.

## 14. Phase 5 implementation record — Delivery: addresses, zones, order tracking (spec § 12)

**Central scope decision — zone picker, not address-to-zone matching**: research before writing any
code found that `DeliveryZone` (base platform Phase 6) is a plain staff-named area with no lat/lng or
polygon anywhere in the schema, and `DeliveryZoneService` is pure CRUD with no "resolve zone from
address" method at all. The spec's flow text ("System verifies delivery zone") reads like geocoding,
but building that would mean inventing address-matching infrastructure that exists nowhere else in
this platform — directly against the spec's own "reuse existing infrastructure" / "no fake
integrations" dev principles. The diner instead picks their own zone directly from this branch's
active zones (`GET .../delivery-zones`, new); their saved/typed address is where the order gets
delivered, never something the system claims to auto-map. This is the same shape of decision as
Phase 2's `resolvePrimaryBranch` (documented, not silently guessed) and Phase 3's "seating preference
is soft, honestly reported" — a real constraint surfaced and designed around, not hidden.

**No delivery ETA**: `DeliveryOrder.estimatedDeliveryAt` is a real schema column, but grepping the
entire codebase found no code path — staff or system — that ever sets it. Promising a delivery time
window would be exactly the kind of unverified claim the spec's dev principles forbid ("Do not claim
... a payment/order is successful until the backend has verified it" — the same honesty principle
extends to time estimates the backend has no way to actually back). A delivery order therefore has no
diner-chosen or system-estimated time field at all — order placement checks the branch is open for
business *right now* instead (delivery orders start moving toward the kitchen immediately, unlike a
scheduled take-out pickup). "Tracking" (spec item 13, applied to delivery) means what the whole
codebase already means by it: watching `DeliveryOrder.status` advance, with a full timeline available
via `DeliveryStatusHistory`. There is no live map — `Driver` has zero GPS/location fields anywhere in
the schema, same finding as the ETA one.

**Address routing shape — restaurant-scoped, not account-wide**: `CustomerAddress` FKs to the
per-organization `Customer` CRM row (Phase 8), not to the platform-wide `CustomerAccount`. An address
a diner saves while ordering from Restaurant A lives on Restaurant A's own `Customer` record and was
never visible to Restaurant B's staff or data anyway, so `/restaurants/[restaurantId]/addresses` (not
a cross-restaurant address book) matches the schema exactly rather than inventing a data shape the
platform doesn't support.

Backend (`restaurant-platform`):

- **`services/customer/CustomerAddressService.ts`** (new) — thin customer-facing wrapper around
  `CustomerService.addAddress`/`updateAddress`/`deleteAddress` (Phase 8, unchanged), same "reuse the
  staff transaction" shape as `CustomerOrderService`/`CustomerReservationService`. `list` is read-only
  (never creates a `Customer` row just from opening "My Addresses" — same
  `findCustomerProfile`-vs-`getOrCreateCustomerProfile` split every other customer service already
  uses); `update`/`remove` resolve the caller's own `Customer.id` first and assert the address
  actually belongs to it before delegating, so another diner's `addressId` 404s.
- **`CustomerService.addAddress`/`updateAddress`/`deleteAddress`'s `actorUserId` widened to
  `string | null`** — the same FK-safety widening `OrderService.createOrder`/`recordPayment` and
  `ReservationService.createReservation` already got in Phases 3/4 (a `CustomerAccount` id must never
  land in `AuditLog.userId`, a real FK to the staff `User` table). No staff caller was affected —
  passing a `string` is still valid.
- **`DeliveryZoneService.listActive`** (new) — active-only zones for a branch, the public read the
  diner-facing picker needs; the existing `list` stays staff-only (includes inactive/retired zones,
  which a diner should never be offered).
- **`lib/validation/customer-order.ts`** — `customerCreateOrderSchema` extended with `type` (`TAKEOUT`
  default, or `DELIVERY`), `deliveryZoneId`, and `deliveryAddressId`/`deliveryAddress`, with `.refine`
  guards mirroring the staff schema's own DELIVERY-requires-address rule: `pickupTime` required only
  for TAKEOUT, `deliveryZoneId` and one of the two address fields required only for DELIVERY.
  `customerListOrdersQuerySchema` gained an optional `type` filter now that this endpoint places both
  order types.
- **`services/customer/CustomerOrderService.ts`** — `createOrder` branches on `input.type`: TAKEOUT
  keeps Phase 4's pickup-time validation unchanged; DELIVERY checks the branch is open right now
  (`assertBranchOpenAt`, renamed from `assertPickupWithinBusinessHours` now that it checks two kinds
  of instants) and resolves the plain-string `Order.deliveryAddress` via the new
  `resolveDeliveryAddress`/`formatAddress` helpers — a `deliveryAddressId` is looked up scoped to the
  caller's own `Customer.id` (never another diner's saved address) and formatted, or the freeform
  `deliveryAddress` string is used as-is. `deliveryZoneId` and the formatted address pass straight
  into the existing `OrderService.createOrder`, which already validates the zone (exists, active,
  branch-scoped) and creates the companion `DeliveryOrder` — no duplicate validation added here.
  `list` now filters to `type: { in: ['TAKEOUT', 'DELIVERY'] }` by default (was hard-coded to
  `'TAKEOUT'` in Phase 4), or a caller-supplied `query.type`. New `getDeliveryStatusHistory` mirrors
  the staff `DeliveryService.getStatusHistory` shape, scoped to the requesting diner's own order the
  same way `get` is; 404s (not an empty list) for a take-out order or another diner's order.
- **Routes** (all new) — `.../addresses` (GET list / POST create) and `.../addresses/[addressId]`
  (PATCH / DELETE), both bearer-auth gated; `.../delivery-zones` (GET), unauthenticated like
  `.../menu` — a diner needs to see whether (and where) a restaurant delivers before committing to an
  account; `.../orders/[orderId]/delivery-status-history` (GET), bearer-auth gated, mirroring the
  staff `.../deliveries/[deliveryId]/status-history` route's shape.
- **Tests**: `tests/unit/customer-orders/validation.test.ts` extended with DELIVERY cases (zone/
  address required, pickup time not required, saved-address-id vs freeform address both accepted);
  `tests/integration/customer/customer-order-service.test.ts` extended with delivery placement
  (snapshot fee, companion `DeliveryOrder` created, saved-address formatting, freeform address,
  rejects another diner's saved address, rejects an inactive zone, `getDeliveryStatusHistory`
  ownership/type scoping, `list` type filtering); new
  `tests/integration/customer/customer-address-service.test.ts` (lazy `Customer` creation, default-
  address exclusivity, update/remove ownership scoping). Same "authored and TS-syntax-checked, not yet
  runtime-executed" status as every other test in this codebase (no `node_modules` in this sandbox).

**Backend verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 4 baseline
(`git stash -u` — including untracked new files, not just tracked edits — against the Phase 4 commit;
3,429, matching the figure Phase 4 itself recorded). After Phase 5: 3,441, +12, zero new categories —
module-resolution (`TS2307` for `next/server`/`vitest` in the four new route files and the new address
test file), implicit-any (`TS7006` in the new `.refine` callbacks and new test-file callbacks), one
`TS2882` (`server-only` side-effect import in the new `CustomerAddressService.ts`), and one further
`TS2591` (`process`, in the new test file). `CustomerService.ts`, `DeliveryZoneService.ts`, and
`customer-order-service.test.ts` each show only line-number-shifted pre-existing diagnostics from this
phase's added comments/fields — not new ones.

Mobile app (`customer-app/`):

- **`src/api/types.ts`** — `DeliveryZone`, `DeliveryStatus`/`DELIVERY_STATUSES`,
  `DeliveryDriverSummary`, `DeliveryOrderSummary`, `DeliveryStatusHistoryEntry`, `CustomerAddress`
  interfaces; `Order` gained `deliveryFee`, `deliveryAddress`, and `delivery` (non-null only on
  DELIVERY orders) — the header comment on `DeliveryOrderSummary` states explicitly why there's no
  lat/lng or ETA field (matches the backend's own honesty finding above).
- **`src/api/client.ts`** — `getDeliveryZones` (public/unauthenticated, same pattern as
  `getRestaurantMenu`/`getReservationAvailability`).
- **`src/screens/shared/AddressManager.tsx`** (new) — self-contained address list + add form + set-
  default + remove, fetched/mutated via `authorizedFetch`. Doubles as the checkout flow's address
  picker via a `selectable`/`onSelect` prop pair, so the same component (and the same live data) backs
  both "manage my addresses" (Profile tab) and "pick a delivery address" (Orders tab checkout) instead
  of two divergent implementations.
- **`src/screens/shared/ProfileScreen.tsx`** — gained a "Delivery addresses" section rendering
  `AddressManager`; also corrected stale copy left over from Phases 3/4 (it still claimed order and
  reservation history were "coming in a later update" even though both tabs had shipped real history
  views by Phase 4 — now only loyalty rewards are flagged as not-yet-built). Dropped a redundant nested
  `ScrollView` this change would otherwise have introduced — `Screen` already scrolls by default.
- **`src/screens/orders/OrdersScreen.tsx`** — checkout gained a Take-out/Delivery type toggle;
  DELIVERY shows the zone picker (fetched from `getDeliveryZones` when the toggle is switched),
  a saved-address-or-freeform-text address picker (reusing `AddressManager` in `selectable` mode), and
  order-type-aware payment/notes copy ("settled at pickup" vs "settled at delivery"). Order history
  rows show type, delivery address, and — for DELIVERY orders — a new `DeliveryTracking` block: current
  status (human-readable label), assigned driver's vehicle/plate/phone if any, and an on-demand full
  status timeline via the new `delivery-status-history` endpoint. `DeliveryTracking`'s own copy states
  plainly there is no live map, matching the backend's honesty finding rather than implying more than
  the data supports.
- **One real bug found and fixed in this pass**: `found[0].id` inside a `found.length === 1` guard
  (auto-selecting a branch's only delivery zone) — flagged by `TS2532` under this project's
  `noUncheckedIndexedAccess`, since a length check doesn't narrow an index access the way a direct
  null check on the element does. Fixed by binding `found[0]` to a local and checking that instead of
  the index expression, the same "real strict-mode catch, not sandbox noise" category the base
  platform's `AuthService.ts`/`seed.ts` implicit-`any` fixes were.
- **Verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 4 baseline
  (`git stash -u`; 94, matching the figure Phase 4 itself recorded). After Phase 5 (and the `TS2532`
  fix above): 101, +7, zero new categories — `TS2307` for unresolved `react`/`react-native` in the one
  new file, `TS7006` implicit-any in new `.map`/`.find` callbacks across `OrdersScreen.tsx` and
  `AddressManager.tsx`, matching every prior phase's pattern exactly. `ProfileScreen.tsx` and the
  pre-existing diagnostics inside `OrdersScreen.tsx` show only line-number shifts from this phase's
  added code, not new diagnostics.
- Same no-test-runner gap as every prior CAPP phase — still out of scope, not bolted on as a side
  quest.

## 15. Phase 6 implementation record — Catering: inquiry, quotation, deposit, balance (spec § 13)

**Central scope decision — "Request changes" is a note, not a status**: `CateringQuoteStatus` (base
platform Phase 7) is `DRAFT | SENT | VIEWED | ACCEPTED | REJECTED | EXPIRED | CANCELLED` — no
`CHANGES_REQUESTED` value anywhere. Spec § 13 lists "Request changes" as a diner action alongside
Accept/Decline, but adding a new enum value would ripple through `QUOTE_ALLOWED_TRANSITIONS` and every
staff view that reads quote status, for something that in real catering practice is a message attached
to an otherwise-still-open quote, not a new lifecycle stage. `CateringQuote` gained a nullable
`customerNote` column instead; `CateringService.recordCustomerQuoteNote` (new) writes it (plus bumps
`respondedAt`, same as an Accept/Decline) without touching `status`, so the quote stays exactly where
staff left it (SENT or VIEWED) and shows up with the note the next time staff open it. Same shape of
decision as Phase 5's "zone picker, not address-to-zone matching" — a real modeling gap surfaced and
designed around, not hidden behind a silent status hack.

**"Budget" — a real column, informational only**: spec § 13's six inquiry fields (event date/time,
location, guest count, event type, food preferences, budget, special requests) map cleanly onto
`CateringInquiry`'s existing columns except budget, which the schema never had. Added
`CateringInquiry.budget Decimal? @db.Decimal(10, 2)`, nullable and never read by
`CateringService.computeQuoteTotals` — staff still quote independently against the real menu and fees,
same as every other free-text inquiry detail. Smuggling it into `specialRequests` instead would have
been the same kind of dishonest shortcut the spec's "no fake integrations" principle rules out
elsewhere.

**Payment honesty carries over from Phase 4/5 unchanged**: `CustomerCateringService.payTowardBalance`
("Pay deposit", also usable for a balance payment) always records `CateringPayment.status: 'PENDING'`,
never `'COMPLETED'` — `lib/payments/PaymentProvider.ts` is still an intentionally-unimplemented seam.
Because `AccountingService.recordCateringDepositReceived`/`recordCateringBalanceSettled` only fire on a
`COMPLETED` payment, a diner's in-app "payment" never posts revenue or a deposit liability by itself;
staff still confirm/settle it for real, same as a take-out or delivery order's cash/GCash/Maya note.
This is a deliberate, documented limitation, not a bug.

**Real-time staff notification of a new inquiry is out of scope this phase**: spec § 13 implies staff
should see "NEW CATERING INQUIRY" the moment a diner submits one. That's a staff-side real-time-event
concern — CAPP Phase 7 ("real-time synchronization... full event wiring") is where it belongs, not
smuggled into Phase 6 as a side quest. What Phase 6 *does* add is the diner-facing acknowledgment:
`CateringService.createInquiry` now fires a new `CATERING_INQUIRY_RECEIVED` notification (Phase 14
infra, extended) after its transaction commits — the same "we got it" pattern Order/Reservation
creation already give — closing a gap that existed even for staff-created inquiries before this phase
(the base platform's `createInquiry` never notified anyone).

Backend (`restaurant-platform`):

- **Schema** (`prisma/migrations/20260820010000_capp_phase6_catering/`) — `CateringInquiry.budget`,
  `CateringQuote.customerNote` (both nullable additive columns), and `NotificationType` gained
  `CATERING_INQUIRY_RECEIVED`. The two column additions were applied and verified against this
  sandbox's live `restaurant_platform`/`restaurant_platform_test` databases (`\d catering_inquiries`/
  `\d catering_quotes` confirm the new nullable columns with every existing FK/index intact). The
  `ALTER TYPE "NotificationType" ADD VALUE` statement could **not** be verified the same way — this
  sandbox's databases are a stale snapshot that predates Phase 14 (Notifications) entirely (confirmed
  via `\dT+ *Notif*` returning zero rows and `\d notifications` finding no such relation), so
  `NotificationType` doesn't exist here to alter. The migration file is correct against
  `schema.prisma` for a real deployment; this gap is specific to this sandbox's pre-existing database
  state, not something Phase 6 introduced, and is recorded here rather than silently glossed over.
- **`services/catering/CateringService.ts`** — `QUOTE_INCLUDE`/`EVENT_INCLUDE` exported (were
  module-private) so `CustomerCateringService` reads the identical shape the staff dashboard sees, same
  widening `OrderService.ORDER_INCLUDE` got in Phase 4. `createInquiry`'s and `updateQuoteStatus`'s
  `actorUserId` widened to `string | null` — same FK-safety pattern as every prior phase's
  customer-initiated write (a `CustomerAccount` id must never land in `AuditLog.userId`, a real FK to
  the staff `User` table). New `recordCustomerQuoteNote` (see "Request changes" above). `recordPayment`'s
  `actorUserId` also widened to `string | null` for the customer-initiated PENDING payment path; its
  three `AccountingService.*` call sites (which post real financial entries and must never run
  anonymously) now go through a new private `requireStaffActor` helper that throws if the actor is
  `null` — narrowing `actorUserId` inside an `if (status === 'COMPLETED')` branch doesn't happen
  automatically in TypeScript since it's a separate variable from the branch condition, so this asserts
  the invariant explicitly rather than a silent non-null assertion.
- **`services/customer/CustomerCateringService.ts`** (new) — mirrors `CustomerOrderService`/
  `CustomerReservationService`'s shape exactly: `createInquiry` (contact identity server-resolved from
  the diner's `Customer`/`CustomerAccount` profile, never free text), `list`/`get` (empty array / 404 for
  a diner with no `Customer` row yet, never auto-creating one just to read), `getQuote` (auto-transitions
  SENT → VIEWED the first time a diner opens it — a real "read receipt", using a state the enum already
  has rather than adding one; response includes `balance` via `CateringService.paymentSummary` once an
  event exists, for spec § 13's "View balance"), `respondToQuote` (Accept/Decline, reusing
  `updateQuoteStatus`'s existing transitions — Accept creates the `CateringEvent` in the same transaction
  exactly as it does for staff), `requestQuoteChanges`, and `payTowardBalance` (rejects if the quote isn't
  accepted yet, rejects overpaying the current balance). Every mutating method resolves the caller's own
  `Customer.id` first and scopes the query directly against it — another diner's `quoteId`/`inquiryId`
  404s exactly like a nonexistent one, the same "don't leak existence" posture every customer service in
  this codebase already follows.
- **`lib/validation/catering.ts`** — `createCateringInquirySchema` gained optional `budget`.
- **`lib/validation/customer-catering.ts`** (new) — `customerCreateCateringInquirySchema` (spec § 13's
  six fields; deliberately excludes staff-only fields like `customerId`/`packageId`/
  `equipmentRequests`/`deliveryRequested` — the diner's six-field form doesn't ask for any of those),
  `customerListCateringInquiriesQuerySchema`, `customerQuoteResponseSchema` (Accept/Decline, with a
  `.refine` requiring `rejectionReason` on Decline), `customerQuoteChangeRequestSchema`, and
  `customerCateringPaymentSchema` (deposit/balance, positive amount only).
- **`services/notifications/NotificationService.ts`** — new `sendCateringInquiryReceived`, fired from
  `CateringService.createInquiry` after its transaction commits (see "out of scope" note above).
- **`lib/validation/notification.ts`** / **`components/notifications/notifications-board.tsx`** —
  `CATERING_INQUIRY_RECEIVED` added to the shared type list and the staff notifications filter dropdown.
- **Routes** (all new, bearer-auth gated, same `getCustomerSession`/`requireCustomerAuthenticated` +
  zod `.parse` + `toErrorResponse` pattern as every other CAPP route) — `.../catering/inquiries` (GET
  list / POST create), `.../catering/inquiries/[inquiryId]` (GET detail),
  `.../catering/quotes/[quoteId]` (GET detail — triggers the SENT→VIEWED transition),
  `.../catering/quotes/[quoteId]/respond` (POST), `.../catering/quotes/[quoteId]/request-changes`
  (POST), `.../catering/quotes/[quoteId]/payments` (POST).
- **Tests**: `tests/unit/customer-catering/validation.test.ts` (new) covers every new schema — budget
  coercion/rejection, staff-only-field stripping, Accept/Decline `rejectionReason` requirement, payment
  amount/method validation. `tests/integration/customer/customer-catering-service.test.ts` (new) covers
  inquiry creation with server-resolved identity and budget, past-event-date rejection, list/get
  ownership scoping, the SENT→VIEWED auto-transition (idempotent on repeat views), Accept creating an
  event and converting the inquiry, Decline requiring a reason, Request-changes recording a note without
  moving status, payment rejection before acceptance and on overpayment, PENDING-never-COMPLETED, and
  cross-diner 404 scoping on both quote actions and payments. Same "authored and TS-syntax-checked, not
  yet runtime-executed" status as every other test in this codebase (no `node_modules` in this sandbox).

**Backend verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 5 baseline
(`git stash -u`, including the untracked new files; 3,441, matching the figure Phase 5 itself recorded).
After Phase 6: 3,459, +18, zero new categories — `TS2307` module-resolution in the six new route files
and the three new/extended validation-or-test files, `TS7006` implicit-any in new `.refine`/service
callbacks (mirrors the same line-number-shifted pre-existing `CateringService.ts` diagnostics from this
phase's added comments/exports — not new positions beyond what the added lines account for), one
`TS2882` (`server-only` in the new `CustomerCateringService.ts` — and notably *only* that one diagnostic
for the whole file, meaning it typechecks cleanly otherwise), and one further `TS2591` (`process`, in the
new integration test file). Specifically checked: the `requireStaffActor` fix's three call sites show no
`TS2345`/`TS2322`/`TS2531`/`TS2532` — the narrowing issue it exists to prevent did not surface as a live
diagnostic, confirming the fix closes what would otherwise have been a real new type error, not just a
defensive change against a hypothetical one.

Mobile app (`customer-app/`):

- **`src/api/types.ts`** — `CateringInquiry`/`CateringQuote`/`CateringEventSummary`/`CateringPayment`/
  `CateringBalanceSummary`/`CateringLineItem` interfaces and their status/type enums, copied field-for
  -field from `CateringService`'s `QUOTE_INCLUDE`/`EVENT_INCLUDE` shapes and the schema. `balance` is
  typed optional (present only on the single-quote detail response, not on list/inquiry-detail
  responses) rather than always-required, matching what the backend actually returns where.
- **`src/screens/catering/CateringModal.tsx`** (new) — full-screen `Modal` opened from Home's
  "Catering" button, not a new bottom tab: spec § 44 fixes the nav at 6 tabs, so — same reasoning as
  `ItemCustomizationModal` for item customization — a feature added in a later phase gets a modal
  instead of reshaping the tab bar. Internal three-level view state (inquiry list → inquiry detail →
  quote detail, plus a "new inquiry" form) is local to the modal, not pushed onto the app's React
  Navigation stack, since the whole flow closes as one unit via `onClose`. `QuoteDetail` surfaces all
  five spec § 13 diner actions in one place: the cost breakdown, Accept/Decline (with a required decline
  reason), Request changes (a free-text note, sent without expecting a status change — copy makes this
  explicit rather than implying a formal request-tracking flow), and — once the quote has an event — the
  balance summary plus a Pay deposit/balance form, whose copy states plainly that no online payment
  gateway is connected yet and the restaurant confirms/settles it afterward, matching the backend's
  honesty finding above.
- **`src/screens/home/RestaurantHomeScreen.tsx`** — "Catering" action button now opens `CateringModal`
  (was a Phase 2-era placeholder navigating to the Orders tab); header comment updated to note Catering
  now leads somewhere real, alongside Menu.
- **One real bug caught before it shipped**: passing `key={refreshKey}` directly to the custom
  `InquiryList` component raised `TS2322` ("Property 'key' does not exist...") — this sandbox has no
  real `@types/react`, so TypeScript can't apply React's usual special-case handling of `key`. This is
  the exact same class of issue `ItemCustomizationModal.tsx`'s "Keyed wrapper, not `key` on SelectRow
  directly" comment already documents; fixed the same way, wrapping `<InquiryList>` in a keyed `<View>`
  instead of keying the component directly.
- **Verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 5 baseline
  (`git stash -u`; 101, matching the figure Phase 5 itself recorded). After Phase 6 (and the `key`-prop
  fix above): 109, +8, zero new categories — `TS2307` for unresolved `react`/`react-native` in the one
  new file, `TS7006` implicit-any in new `.map`/`.filter` callbacks across `CateringModal.tsx`, and
  `TS2741` (JSX children-prop, from the same missing-React-types cause as every prior phase) with
  line-number-shifted positions in `RestaurantHomeScreen.tsx` — not new ones.
- Same no-test-runner gap as every prior CAPP phase — still out of scope, not bolted on as a side quest.

## 16. Phase 7 implementation record — Real-time synchronization (spec § 43)

**What this phase actually found, before writing any code**: research at the start of this phase
(re-reading § 6/§ 10's claims against the real codebase) found that nothing described there had
been built. `RealtimeEvent` existed as a table with zero writers and zero readers — no emit helper
anywhere in `services/`/`lib/`, no `app/api/v1/restaurants/[restaurantId]/events/stream` route, and
`customer-app` had no `EventSource`/streaming code of any kind. § 6's own "2–3 real emit call
sites" claim was checked directly against `CustomerAccountService.register` and
`RestaurantDirectoryService.upsertBranding` — neither one ever wrote a `RealtimeEvent` row. That
correction is recorded in § 6 itself, not just here, so a reader of this doc's earlier sections
doesn't inherit a false premise. This phase is therefore not "extend the emit helper to more call
sites" — it's the actual first implementation, on top of a design that (once verified) turned out
to be sound.

**Scope decision — what spec § 43's 21-event catalog this build can honestly wire**: quoted
verbatim from the original spec document (§ 43 "REAL-TIME EVENTS"), the list is
`ReservationCreated/Confirmed/Cancelled`, `OrderCreated/Accepted/Preparing/Ready/OutForDelivery/
Delivered`, `PaymentConfirmed/Failed`, `CateringInquiryCreated`, `CateringQuoteCreated/Accepted`,
`MenuItemAvailabilityChanged`, `PromotionCreated/Updated/Started/Ended`, `CampaignScheduled/Sent`,
`NotificationCreated` — 21 named events. This build wires 14 of them (see
`lib/realtime/emit.ts`'s `REALTIME_EVENT_TYPES`) and deliberately omits seven, each for a documented
reason rather than an oversight:

- **`PaymentFailed`**: every payment-status enum in this codebase (`OrderPaymentStatus`,
  `CateringPaymentStatus`) is `PENDING | COMPLETED | REFUNDED` — there is no `FAILED` state anywhere
  a payment could land, because there's no real payment gateway (`lib/payments/PaymentProvider.ts`)
  to report a decline. Emitting an event from a state that can never be reached would be a fake
  signal.
- **`PromotionCreated/Updated/Started/Ended`, `CampaignScheduled/Sent`** (6 events): no
  `Promotion`/`Campaign` model or service exists yet — § 5's schema preview is the real build,
  landing in CAPP Phase 8. Wiring events for a subsystem that doesn't exist would mean inventing
  fake trigger sites.
- **`NotificationCreated`**: `NotificationService`'s `RecipientInfo` (a guest-contact snapshot
  carried through ~10 `send*` methods) has no `customerAccountId` anywhere in it — wiring this
  honestly means threading that id through every one of those methods and every caller, a change far
  larger than "add one emit call" and outside this phase's own scope. It also has nowhere to land
  yet: the customer app has no notification-center UI to consume it (CAPP Phase 9). Deferred there
  by name, not silently dropped — the same "belongs to a later phase" reasoning already used for
  Promotion/Campaign above, and the same shape of decision CAPP Phase 6 used when it deferred the
  staff-side "new catering inquiry" real-time notification into this phase (which this phase now
  closes — see `CateringInquiryCreated` below).

**Design decision — personal vs. broadcast events, and why this needed a schema change § 6 didn't
anticipate**: § 6's original design scoped the SSE stream "to that organization" with no mention of
per-customer filtering. Building the route for real surfaced the problem directly: an org-wide
stream would broadcast every diner's own order/reservation/catering events to every other connected
diner and to anonymous browsers — a real privacy leak, not a hypothetical one. Fixed by adding
`RealtimeEvent.customerAccountId` (nullable — see the migration below) and having
`lib/realtime/emit.ts`'s `resolveEventCustomerAccountId` resolve it from whichever `Customer.id`
the triggering entity already carries. A personal event (a diner's own `OrderAccepted`) is
addressed to exactly that `CustomerAccount`; a broadcast event with no single owner
(`MenuItemAvailabilityChanged`) is addressed to nobody, delivered to every connected client whether
signed in or not. A personal event whose triggering record has no linked `CustomerAccount` (a
staff-created walk-in order or phone booking) still gets recorded — for the outbox's own sake — it
simply has no app session to ever deliver it to, which is correct, not a bug: there's no diner
using the app to notify.

**Design decision — the SSE route allows optional auth, unlike every other customer route**: every
other `/api/v1/restaurants/[restaurantId]/**` mutation/detail route calls
`requireCustomerAuthenticated`, 401-ing an anonymous caller. This route calls the lower-level
`getCustomerSession` directly and treats a `null` result (no/invalid token) as a legitimate
anonymous connection, not an error — a diner browsing the menu before creating an account still
needs `MenuItemAvailabilityChanged` to reach them live. Signed-in vs. anonymous only changes which
`RealtimeEvent` rows the poll query's `customerAccountId` filter lets through, not whether the
connection is allowed at all.

**Design decision — standards-based reconnect via `Last-Event-ID`, not a custom protocol**: the SSE
route writes a real `id:` field on every frame (the `RealtimeEvent.id` itself) and, on a fresh
connection, reads back the `Last-Event-ID` request header a reconnecting client sends — resuming
the poll cursor from exactly that row instead of either replaying the restaurant's whole event
history or silently dropping whatever happened during a gap. This is what makes the server's own
`MAX_CONNECTION_MS` cap (4 minutes — no long-running process backs a plain Next.js Route Handler, so
an unbounded-duration streaming response risks a platform execution-time cutoff killing it
mid-write) invisible to the app as anything other than a brief, lossless reconnect.

Backend (`restaurant-platform`):

- **Schema** (`prisma/migrations/20260820020000_capp_phase7_realtime/`) — adds the nullable
  `RealtimeEvent.customerAccountId` column plus its FK to `customer_accounts` and index (see the
  personal-vs-broadcast design decision above). **Could not be verified against this sandbox's live
  Postgres** — unlike CAPP Phase 6's narrower gap (that phase's databases were merely missing Phase
  14's tables), this sandbox's `restaurant_platform`/`restaurant_platform_test` databases have *no*
  `realtime_events` table and *no* `customer_accounts` table at all (`\d realtime_events` /
  `\d customer_accounts` both return "did not find any relation"), confirming these are a snapshot
  that predates CAPP entirely. The migration is correct against `schema.prisma`; this is a
  pre-existing sandbox-provenance limitation this phase inherited and is documenting honestly, not
  one it introduced.
- **`lib/realtime/emit.ts`** (new) — `emitRealtimeEvent` (the outbox writer — takes either the
  shared client or a `Prisma.TransactionClient`, so every call site passes the same `tx` its primary
  write used, preserving the "event and cause commit or roll back together" guarantee § 6's outbox
  design exists for) and `resolveEventCustomerAccountId` (the one extra lookup — `Customer.id` ->
  `Customer.customerAccountId` — every call site needs to address a personal event correctly).
  `REALTIME_EVENT_TYPES` is the narrowed 14-event catalog with the full omission reasoning in its
  own header comment (summarized above).
- **Wired call sites** (11 across 5 services, all inside their mutation's existing transaction):
  - `ReservationService.createReservation` -> `ReservationCreated`; `updateStatus` -> `Confirmed`/
    `Cancelled` only (no event for `SEATED`/`COMPLETED`/`NO_SHOW` — not in the § 43 catalog);
    `recordDeposit`'s `PENDING`->`PAID` transition -> `PaymentConfirmed` (`kind: 'RESERVATION_DEPOSIT'`
    in the payload, alongside the existing `AccountingService.recordReservationDepositPaid` posting).
  - `OrderService.createOrder` -> `OrderCreated`; `updateStatus` -> `Accepted`/`Preparing`/`Ready`
    only (`COMPLETED`/`CANCELLED` have no named event; delivery's own progress comes from
    `DeliveryService` instead, since that's a separate state machine — see schema.prisma's Phase 6
    comment); `recordPayment`'s `COMPLETED` branch -> `PaymentConfirmed` (`kind: 'ORDER_PAYMENT'`) —
    a customer-recorded payment is always `PENDING` (Phase 4's "never claim success until verified"
    rule), so this only ever fires from an actual staff confirmation.
  - `DeliveryService.updateStatus` -> `OrderOutForDelivery`/`OrderDelivered` on `PICKED_UP`/
    `DELIVERED` only (this is `DeliveryOrder.status`, a different state machine from `Order.status`
    — see this file's own `ALLOWED_TRANSITIONS` comment).
  - `CateringService.createInquiry` -> `CateringInquiryCreated` — this is also the real-time
    counterpart to the staff-side "new inquiry" notification gap CAPP Phase 6 identified and
    deferred here (§ 15); `updateQuoteStatus` -> `CateringQuoteCreated` at `SENT` (not the earlier
    `DRAFT` `createQuote` — a `DRAFT` quote is staff-only working state the diner never sees, so a
    quote "is created" from the customer app's perspective the moment it becomes visible to them,
    same reasoning `CustomerCateringService.getQuote`'s `SENT`->`VIEWED` transition already
    documents) and -> `CateringQuoteAccepted` at `ACCEPTED`; `recordPayment`'s `COMPLETED` branch ->
    `PaymentConfirmed` (`kind: 'CATERING_PAYMENT'`).
  - `MenuService.updateItem` -> `MenuItemAvailabilityChanged`, only when `available` actually flips
    (not every unrelated field edit) — broadcast (no `customerAccountId`; `MenuItem` is
    organization-wide, no `branchId` column either).
- **`app/api/v1/restaurants/[restaurantId]/events/stream/route.ts`** (new) — the SSE endpoint § 6
  designed and this phase actually builds: optional auth, `Last-Event-ID` resumable cursor, a
  `ReadableStream` polling `RealtimeEvent` every 3s and writing standards-compliant SSE frames, a
  20s comment-only keep-alive ping (so intermediary proxies don't treat a quiet connection as idle),
  and a clean self-close at 4 minutes so a reconnect is guaranteed lossless rather than relying on
  a platform timeout to kill the connection mid-write. Full reasoning for each of these in the
  route's own header comment and this section's design-decision paragraphs above.
- **Tests**: none added this phase. Every existing service-level integration test that exercises a
  now-event-emitting method (`ReservationService`/`OrderService`/`DeliveryService`/
  `CateringService`/`MenuService`'s existing test suites) continues to pass unmodified — emitting
  inside the same transaction as an already-tested write doesn't change that write's own observable
  behavior, and this codebase has no test-runner execution in this sandbox to actually confirm that
  either way (same "authored and TS-syntax-checked, not yet runtime-executed" status as every prior
  phase's tests). A dedicated test for the SSE route itself and the outbox's poll-query filtering
  would need a way to drive a live streaming HTTP response and simulate concurrent readers, which
  this project's existing Vitest+Prisma integration-test pattern doesn't have infrastructure for —
  flagged as a real gap, not silently skipped.

**Backend verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 6
baseline (`git stash -u`; 3,459, matching the figure Phase 6 itself recorded). After Phase 7: 3,462,
+3 net (48 new / 46 removed lines — the near-equal counts are line-number shifts from this phase's
added comments/code inside `CateringService.ts`/`DeliveryService.ts`/`MenuService.ts`/
`OrderService.ts`/`ReservationService.ts`, not new positions), zero new diagnostic categories —
`TS2307` (module resolution, in the two brand-new files: the SSE route's `next/server` import and
`emit.ts`'s `@prisma/client` import), one `TS2882` (`server-only` in the new `emit.ts` — and, same
as `CustomerCateringService.ts` in Phase 6, the *only* diagnostic for that whole file, meaning it
typechecks cleanly otherwise), and `TS7006` implicit-any, matching every prior phase's pattern.

Mobile app (`customer-app/`):

- **`src/realtime/RealtimeEventsContext.tsx`** (new) — one shared SSE connection per viewed
  restaurant, opened at the app root (same "one shared thing, many consumers" shape `AuthContext`/
  `RestaurantContext` already use), exposing `subscribe(eventType, handler) -> unsubscribe`. React
  Native has no native `EventSource` — rather than adding an unverifiable third-party polyfill
  package (this sandbox has no `node_modules`, so a new dependency could never actually be resolved
  or run here — the same "no fake integrations" reasoning that's kept every other seam in this app
  honest), this implements the same technique those polyfills use internally:
  `XMLHttpRequest.responseText` grows incrementally on a streaming response, firing a `progress`
  event on each growth even before the request completes; accumulating and splitting that text on
  blank lines reconstructs the same frames a real `EventSource` would deliver. Reconnects on error
  or on the server's own clean close (both handled identically via `Last-Event-ID`, per the backend
  design decision above) and re-opens whenever the signed-in identity changes, so a stream that
  started anonymous upgrades to receiving the now-signed-in diner's personal events without a full
  app restart, and a signed-out diner stops receiving a stale account's events.
- **`App.tsx`** — `RealtimeEventsProvider` added inside both `AuthProvider` and `RestaurantProvider`
  (needs `accessToken` and `publicCode` from each) and outside `CartProvider` (unrelated).
- **Wired consumers** (4 screens, each just calling its own existing `load()` on a relevant event —
  no new fetch logic, no new UI): `MenuScreen` refetches on `MenuItemAvailabilityChanged` (the
  backend filters unavailable items out of the response entirely rather than flagging them — see
  `RestaurantDirectoryService.getPublicMenu` — so there's no per-item field to patch locally; a full
  refetch is the correct response, not a shortcut); `OrdersScreen`'s `OrderHistory` refetches on
  every `Order*` progress event plus `PaymentConfirmed` filtered to `payload.kind ===
  'ORDER_PAYMENT'` (the same event type also fires for reservation deposits and catering payments,
  distinguished only by that payload field — filtering here avoids a pointless extra fetch, not a
  correctness fix); `ReservationsScreen`'s `ReservationHistory` refetches on
  `ReservationCreated`/`Confirmed`/`Cancelled`; `CateringModal`'s `InquiryList` refetches on
  `CateringInquiryCreated`/`QuoteCreated`/`QuoteAccepted`. Every case relies on the stream already
  being scoped to the signed-in diner's own events server-side — no client-side ownership filtering
  needed beyond the one `payload.kind` check above.
- **Verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 6 baseline
  (`git stash -u`; 109, matching the figure Phase 6 itself recorded). After Phase 7: 113, +4 net (32
  new / 28 removed — again mostly line-shifts from added subscribe-effect blocks in the four edited
  screens), zero new diagnostic categories — `TS2307` (unresolved `react-native` in the one new
  file), one `TS2591` (`process.env.EXPO_PUBLIC_API_BASE_URL`, matching this project's other
  `process.env` references — expected without `@types/node`), `TS7006` implicit-any in new
  callbacks, and line-shifted `TS2741`/`TS7053` — not new ones.
- Same no-test-runner gap as every prior CAPP phase, and the same "authored, not device-verified"
  status as every file in this app — still out of scope, not bolted on as a side quest.

## 17. Phase 8 implementation record — Promotions: engine, targeting, campaign management, redemption (spec § 16-32)

**Scope boundary, decided before writing any code**: `git show --stat` against every prior CAPP
phase's own first commit confirms a consistent pattern — every phase built customer-facing
`app/api/v1/**` routes and, where the spec called for it, staff-facing routes elsewhere under
`app/api/**` (e.g. `app/api/branding/route.ts` from Phase 1), but **none of them built new staff
dashboard (`app/dashboard/**`) pages**. `BRANDING_MANAGE` has existed as a real, enforced permission
since Phase 1 with no dashboard page ever built for it — the same gap this phase's own
`PROMOTION_MANAGE` permission now sits in. Phase 8 follows that established boundary rather than
inventing dashboard scope no prior phase had: this build is the promotions/campaign engine, its
staff API surface, and the mobile app's Promotions screen and checkout integration — not a new
admin UI.

**Schema — five tables, org-scoped, not branch-scoped** (`prisma/migrations/
20260820030000_capp_phase8_promotions/`): `Promotion` (title/description/promoCode/discountType/
discountValue/minimumOrderValue/maximumDiscount/startAt/endAt/startTimeOfDay/endTimeOfDay/
eligibleServices/eligibleMenuItemIds/eligibleCategoryIds/usageLimit/customerUsageLimit/
redemptionCount/terms/status), `PromotionCampaign` (audience targeting config + send state),
`CampaignAudience` (materialized recipient list from a send), `CustomerPromotion` (a diner's
claim/save-offer record), `PromotionRedemption` (the append-only ledger of actual uses). Four new
enums: `PromotionDiscountType` (14 values, matching spec § 17 exactly), `PromotionStatus`,
`CampaignStatus`, `PromotionAudienceType` (14 values, matching spec § 19), plus
`CustomerPromotionStatus`. This is close to but not identical to § 5's original schema preview —
the real shape, worked out against actual redemption/targeting logic rather than sketched in
advance, is what's documented here.

**Design decision — effective status is derived, not stored, because this build has no
scheduler**: same constraint Phase 7 designed around for its SSE polling loop — there is no cron job
or background worker anywhere in this codebase. A promotion's stored `status` column only tracks
staff-driven states (`DRAFT`, `PAUSED`, `CANCELLED` are always staff actions; `ENDED` can be either).
`PromotionService.deriveEffectiveStatus` computes the status actually shown to diners fresh on every
read: `DRAFT`/`PAUSED`/`CANCELLED`/`ENDED` pass through unchanged, but `SCHEDULED`/`ACTIVE` collapse
into pure date math (`now < startAt` → `SCHEDULED`; `endAt` in the past → `ENDED`; otherwise
`ACTIVE`). This is what lets spec § 20's "Schedule for later" start and stop exactly on time with
zero scheduler infrastructure — the same trick, applied to a new subsystem.

**Design decision — two-phase redemption for race-safety**: `validateAndPreviewDiscount` runs
read-only, before `OrderService.createOrder` opens its transaction — it checks eligibility (status,
time-of-day window via the same `lib/utils/business-hours.ts` primitives Phase 3 built for
reservation hours), minimum order value, eligible services/items/categories, usage limits, and
type-specific gates, then computes the discount amount. `recordRedemption` runs *inside* that same
transaction, immediately after the `OrderCreated` emit: it re-validates fresh, then does the atomic
part — `tx.promotion.update({ data: { redemptionCount: { increment: 1 } } })`, the same
atomic-increment idiom `InventoryService.applyTransaction` already uses for `quantityOnHand` — and
only *after* that checks whether the post-increment count exceeds `usageLimit`, throwing to roll
back the whole order transaction if so. This means no partial-redemption state is ever reachable:
either the whole order (with its discount) commits, or none of it does. A useful side effect worth
recording: the increment's row-level lock on `Promotion` serializes every concurrent redemption
attempt against that promotion — including from different customers — which incidentally also makes
the separate per-customer `customerUsageLimit` count check race-safe without any additional locking.

**Discount computation, by type — what's real this phase vs. what's honestly out of scope**: of the
14 discount types spec § 17 defines, 11 compute a real amount through order checkout —
`PERCENTAGE`/`FIXED_AMOUNT` compute directly; `FREE_DELIVERY` returns a separate `waiveDeliveryFee`
flag rather than folding into `discountTotal` (so it can't be wrongly capped at subtotal — a small
order with a large delivery fee should still get the fee fully waived); `BOGO`/`FREE_ITEM` use the
price of the cheapest eligible line item as a documented simplification, not full free-item
selection; `FIXED_AMOUNT`/`BUNDLE`/`FREE_ADDON`/`FIRST_ORDER`/`REPEAT_CUSTOMER`/`BIRTHDAY`/
`CUSTOMER_SPECIFIC` all resolve to a flat `discountValue` peso amount, with the latter four read as
eligibility *gates* layered on that flat discount (the spec doesn't specify a separate rate-vs-amount
shape for those four, so this is a deliberate simplifying reading, not an oversight). Three types are
explicitly rejected at redemption, each with a reason: `LOYALTY_REWARD` (no `LoyaltyAccount` model
exists yet — CAPP Phase 10's job); `CATERING_DISCOUNT`/`RESERVATION_DISCOUNT` (no redemption call
site is wired outside order checkout this phase — reservations and catering quotes have their own
pricing flows this build doesn't touch). Type-specific eligibility gates
(`assertTypeSpecificEligibility`): `FIRST_ORDER` requires zero prior non-cancelled orders;
`REPEAT_CUSTOMER` requires at least one; `BIRTHDAY` requires `CustomerAccount.dateOfBirth` within
±3 days of today; `CUSTOMER_SPECIFIC` requires an existing, non-expired `CustomerPromotion` claim —
i.e. only redeemable once already targeted via a campaign or an explicit claim. The computed amount
is capped at `maximumDiscount` (if set) and at the order subtotal, except `FREE_DELIVERY`, which is
fee-based and exempted from the subtotal cap for the reason above.

**Audience targeting — a real, table-driven resolver, not a DSL** (`services/promotions/
AudienceResolver.ts`): spec § 32 calls for a "configurable rule engine." This build answers that
with a `RESOLVERS: Record<PromotionAudienceType, Resolver>` table covering all 14 audience types
from spec § 19, each resolver querying only data that already exists on this platform — `Customer`,
`Order`, `Reservation`, `CateringInquiry`, and the RFM segmentation this platform's own CRM work
(`lib/crm/rfm.ts`) already built for `CustomerService.getAnalytics`. This is deliberately not a full
expression-parser DSL — nothing else in this codebase has infrastructure for one, and building one
just for this would be inventing scope the spec's own examples (segment-, behavior-, and
recency-based targeting) don't actually require. `LOYALTY_TIER` throws a `ConflictError` rather than
silently resolving empty (Phase 10 dependency, same "flag rather than fake" rule every prior phase
has followed); `LOYAL` is mapped to the existing RFM VIP+REGULAR segments rather than a
not-yet-built points-tier system, documented as a substitution, not a silent guess. Every resolver
is scoped to `Customer.customerAccountId != null` (only diners with a real app account can be
targeted), and the central `resolveAudience()` entry point applies spec § 26's opt-out rule exactly
once regardless of which resolver produced a candidate — filtering out anyone with
`marketingOptIn: false` or `CustomerNotificationPreference.allowPromotional: false`.

**Campaign send — stops at "audience materialized," by design**: `PromotionCampaignService.send`
resolves the audience, writes it into `CampaignAudience` rows inside a transaction, marks the
campaign `ACTIVE` with `sentAt`, and emits `CampaignSent`. It deliberately does not attempt actual
push/email/SMS dispatch — spec § 33's own notification-queue diagram has five stages (Campaign
service → Audience calculation → Notification queue → Workers → Customer), and this phase
implements only the first two. The remaining three are CAPP Phase 9's declared scope (Notification
Center) — building them here would mean building notification-delivery infrastructure this doc's
own Phase 7 record already deferred for the same reason.

**Real-time events — the six Phase 7 left deferred, now wired**: `PromotionCreated/Updated/Started/
Ended` and `CampaignScheduled/Sent` are all implemented as **broadcast** events (no
`customerAccountId`) — including `CampaignSent`, which is a staff-audit-style signal recording that
a send happened, not a per-recipient notification fanned out to each audience member (that
per-recipient in-app delivery is explicitly Phase 9's job, same boundary as campaign dispatch
above).

**Order checkout integration**: `OrderService.createOrder` accepts an optional `promoCode`; if
present, it requires `customerId` to already be set (throws `ConflictError` — "a promo code
requires a signed-in customer" — otherwise), calls `PromotionService.validateAndPreviewDiscount`
before opening its transaction using the freshly-resolved order items for subtotal/eligibility
context, folds the discount (and, for `FREE_DELIVERY`, the zeroed delivery fee) into the existing
`computeOrderTotals`, and — inside the transaction, immediately after the `OrderCreated` emit —
calls `PromotionService.recordRedemption`. `resolveAndPriceItems` now also returns each resolved
item's `categoryId` (an in-memory addition for this request's eligibility check only, never
persisted onto `OrderItem`), since promo eligibility can be scoped by menu category.

**Staff API surface** (all gated by the new `PROMOTION_MANAGE` permission, staying manager-and-up
per the same pattern § 15 recorded for `CATERING_MANAGE`): `GET/POST /api/promotions`,
`GET/PATCH /api/promotions/[promotionId]`, `PATCH /api/promotions/[promotionId]/status`,
`GET/POST /api/campaigns`, `GET/PATCH /api/campaigns/[campaignId]`,
`PATCH /api/campaigns/[campaignId]/status`, `POST /api/campaigns/[campaignId]/send`,
`GET /api/campaigns/[campaignId]/audience-preview` (a dry-run resolve, for staff to see who a
campaign would reach before committing to a send).

**Customer API surface** (`app/api/v1/restaurants/[restaurantId]/promotions/**`):
`GET /` (public, unauthenticated — active + upcoming, spec § 22's browse view),
`GET /mine` (auth required — every claim, with `effectiveStatus` attached),
`POST /validate` (auth required — the checkout cart-preview `OrdersScreen` calls),
`GET /[promotionId]` (public — single-promotion detail, spec § 22's deep-link target),
`POST /[promotionId]/claim` (auth required — "save this offer").

**Mobile app**: `PromotionsScreen.tsx` (new) replaces the last `ComingSoonScreen` tab stub — two
tabs, "Offers" (public, active + upcoming, subscribes to the four Promotion real-time events for
live refresh, matching `MenuScreen`'s existing `MenuItemAvailabilityChanged` pattern) and "My
offers" (auth-required, buckets claims into active/redeemed/expired). `OrdersScreen`'s cart
checkout gained a promo-code field: entering a code calls the `validate` endpoint for a live
preview before the order is ever submitted, and the code is only sent with the final order once a
preview has actually succeeded — never speculatively.

**Backend verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 7
baseline (`git stash -u`; 3,462, matching the figure Phase 7 itself recorded). After Phase 8: 3,507,
+45 net, zero new diagnostic categories once three genuine `noUncheckedIndexedAccess` gaps were
found and fixed (not left as noise): indexing `Record<EnumType, T>` maps
(`AudienceResolver.ts`'s `RESOLVERS[audienceType]`, and `ALLOWED_TRANSITIONS[existing.status]` in
both `PromotionService.ts` and `PromotionCampaignService.ts`) surfaced as `TS18048`/`TS2722`/
`TS2532` because the enum types resolve to unconstrained types without `@prisma/client`'s generated
types present in this sandbox, so TypeScript can no longer treat the map's key space as exhaustive.
Fixed with defensive guards (a thrown `ConflictError` for the resolver lookup, `?? []` fallbacks for
the transition-map lookups) — genuinely unreachable given the enums are closed and every key is
present, but the guard gives a clear error instead of a raw crash if that ever stops being true, and
it satisfies the compiler honestly rather than suppressing the diagnostic. After the fixes, the
remaining categories are the same established noise as every prior phase: `TS7026`/`TS7006`
implicit-any, `TS2307` module-not-found, `TS2882` `server-only` side-effect imports, `TS2591`
missing globals, `TS7031`/`TS2503`/`TS7053` from the same missing-`node_modules` root cause.

**Mobile verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 7
baseline (`git stash -u`; 113, matching the figure Phase 7 itself recorded). After Phase 8: 126,
+13 net, one genuinely new category (`TS2322`) found and fixed rather than accepted: `PromotionCard`/
`ClaimCard` were invoked with `key` passed directly on the custom component
(`<PromotionCard key={promo.id} ... />`), unlike this codebase's established convention — see
`ItemCustomizationModal.tsx` — of keying the wrapping `<View>` and leaving the custom component
itself unkeyed. Under this sandbox's degraded JSX type resolution (no `node_modules`, so React's
prop types don't resolve enough to recognize `key` as a reserved prop), that difference surfaces as
a real excess-property error; fixed by matching the established wrapping-`View` pattern in all five
call sites, which also makes the code consistent with the rest of the app rather than a one-off
exception. After the fix, remaining categories are the same established noise as every prior
phase: `TS7006` implicit-any, `TS2307` unresolved `react-native`/`@react-navigation` imports,
`TS2741` JSX children-prop, `TS2591` missing `process.env` typing, `TS7053`.

Same no-test-runner gap as every prior CAPP phase — flagged, not silently skipped.

## 18. Phase 9 implementation record — Notifications: push tokens, notification center, campaign dispatch, anti-spam (spec § 21-27, § 33-34, § 47-48, § 51)

**Scope boundary, decided before writing any code**: same check as every prior CAPP phase —
`git show --stat` against Phases 1-8's own first commits confirms none of them touched
`app/dashboard/**`. Phase 9 follows that boundary too: this build is the notification-center
backend, the campaign-dispatch worker entry point, and the mobile app's Notification Center +
preferences screens — not a new staff dashboard page. The one staff-facing surface this phase adds
(`POST /api/campaigns/dispatch`) is a plain `PROMOTION_MANAGE`-gated API route, the same pattern
§ 17 used for `audience-preview`.

**Three distinct notification concepts, not one — kept carefully separate**: `RealtimeEvent`
(Phase 7) is a transient outbox tailed by SSE, never queried as a list or persisted for the diner to
browse later. The base platform's own `Notification` model (Phase 14) is staff-triggered guest
email/SMS, branch-scoped, with no "read" state — a different subsystem serving a different
audience (restaurant guests, not necessarily app account holders) that this phase does not touch.
`CustomerNotification` (new, this phase) is the one thing spec § 27 actually means by "Notification
Center": the diner's own persistent, in-app inbox, one row per entry, with `isRead`/`readAt`.

**Schema — three new tables** (`prisma/migrations/20260821000000_capp_phase9_notifications/`):
`CustomerPushToken` (token globally unique, upsert-on-conflict — a reinstalled or reassigned device
claims the row cleanly instead of erroring), `CustomerNotification` (category — `ORDER`/
`RESERVATION`/`PAYMENT`/`PROMOTION`/`LOYALTY`/`CATERING`/`SYSTEM` — title, message, `deepLink`,
`isRead`/`readAt`, optional `campaignId`, `@@unique([campaignId, customerAccountId])` so a campaign
send can never double-notify the same diner even if `send()` were somehow invoked twice), and
`NotificationDelivery` (per-channel funnel state — `PUSH`/`EMAIL`/`SMS`/`IN_APP` ×
`QUEUED`/`SENT`/`DELIVERED`/`OPENED`/`FAILED`/`UNSUBSCRIBED`/`BOUNCED`, matching spec § 34 exactly).
This is the real shape referenced from § 5's updated schema preview above.

**Design decision — a single funnel for every notification-center write**: `lib/realtime/emit.ts`'s
`emitRealtimeEvent` gained an optional `notification?: NotificationContent` field. When both
`customerAccountId` and `notification` are present, the same transaction that writes the
`RealtimeEvent` also writes a `CustomerNotification` row (via a newly-exported
`writeCustomerNotification`) and fires a generic `'NotificationCreated'` event (added to
`REALTIME_EVENT_TYPES`) — one code path, reused by every existing personal-event call site that
now also wants a durable inbox entry, rather than a parallel notification-writing call bolted onto
each one individually. Two sources have no matching spec § 43 business event to piggyback on, so
they call `writeCustomerNotification` directly: `PromotionService.claim` (an "Offer saved"
confirmation, best-effort — wrapped in try/catch so a notification failure can never undo the
claim itself) and `PromotionCampaignService.send` (per-audience-member fan-out, below).

**Design decision — campaign send stops at "queued," matching spec § 33's own diagram**:
`PromotionCampaignService.send` (already writing `CampaignAudience` rows since Phase 8) now also,
inside that same transaction and for every audience member, writes a `CustomerNotification` row
(category `PROMOTION`, `campaignId` set) plus `NotificationDelivery` rows: `IN_APP` is written
already `DELIVERED` — the `CustomerNotification` row's existence *is* the delivery, no external
call needed — while `PUSH`/`EMAIL`/`SMS` are written `QUEUED`, never dispatched synchronously. This
is spec § 33's own instruction ("do not send thousands of notifications directly inside a web
request") taken literally, using the same "real interface, needs a future job" pattern this doc has
used since Phase 14's `sendReservationReminder` — the honest trigger point built instead is
`NotificationDispatchService.dispatchQueued`, invoked via the new
`POST /api/campaigns/dispatch` route an external scheduler (or a staff member) can call, since this
sandbox has no cron/Redis/BullMQ to invoke it automatically. `NotificationDispatchService` never
marks a delivery `DELIVERED`/`OPENED` — no provider webhook exists to confirm those stages — only
`SENT` or `FAILED`, the same ceiling the base platform's own `NotificationStatus` already respects.

**Anti-spam (spec § 51) — built from data this platform already has, no new tracking
infrastructure**: org-level opt-out was already enforced in `resolveAudience()` since Phase 8
(unchanged). This phase adds: per-channel opt-out in `send()`'s fan-out, checked against each
member's `CustomerNotificationPreference.pushPromotions`/`emailPromotions`/`smsPromotions` — a
disallowed channel gets an `UNSUBSCRIBED` delivery row instead of a `QUEUED` one; duplicate
prevention is structural, via `CustomerNotification`'s own `@@unique([campaignId,
customerAccountId])` plus `send()` only being callable from `DRAFT`/`SCHEDULED` (a campaign can
never be sent twice); a rolling frequency-limit window (`lib/notifications/
customer-app-settings.ts`, default 24h, configurable via
`Organization.customerAppSettings.notifications.promotionalFrequencyLimitHours`) — a throttled
account still gets its in-app entry but no `PUSH`/`EMAIL`/`SMS` rows for that send, checked via one
lightweight query (`findThrottledAccountIds`) against existing `CustomerNotification` rows, not a
new counter table; and quiet hours (default 9pm-8am Asia/Manila, same config file, configurable),
checked at dispatch time — `dispatchQueued` skips its whole batch if invoked within the window,
rather than partially draining the queue. `dispatchBatchSize` (default 200) caps how many `QUEUED`
rows one dispatch call processes, standing in for the natural concurrency limit a real worker pool
would have.

**Push tokens — real registration, no real token source**: `CustomerPushToken` and its two
customer-facing routes (`POST /api/v1/customer/push-tokens`, `DELETE
/api/v1/customer/push-tokens/[token]`) are fully real — a device can register and unregister a
token today. What's deliberately not built is the mobile-side call site that would produce an
actual Expo/APNs/FCM token: same reasoning Phase 7 used to skip `expo-notifications` (no
`node_modules` in this sandbox to install or verify an unfamiliar native package against), but a
sharper case than Phase 7's SSE gap — SSE had a pure-JS XHR workaround this build actually used;
there is no equivalent pure-JS way to obtain a real platform push token, so this is flagged as a
genuine gap in both `PushProvider.ts`'s header and the new schema's comments, not quietly worked
around.

**In-app "deep link" is a tab name, not an OS-level link**: `CustomerNotification.deepLink` stores
one of `MainTabParamList`'s 6 tab names (Home/Menu/Promotions/Orders/Reservations/Profile) — plain
in-app navigation, not spec § 22's `https://app.example.com/r/...` universal-link format. Real OS
deep linking has been a documented, unbuilt gap in `RestaurantContext.tsx` since CAPP Phase 1
(needs `expo-linking` config plus production app-store identifiers this sandbox doesn't have); this
phase reuses that same honest gap rather than half-closing it. The mobile app guards unrecognized
values with a `NAVIGABLE_TABS` set so tapping a malformed or future-category deep link silently
does nothing instead of crashing.

**Staff API surface**: `POST /api/campaigns/dispatch` (`PROMOTION_MANAGE`-gated, optional `limit`
in the body, calls `NotificationDispatchService.dispatchQueued`).

**Customer API surface** (`app/api/v1/restaurants/[restaurantId]/notifications/**` plus a new
top-level `app/api/v1/customer/**` group for account-wide, non-restaurant-scoped resources):
`GET /notifications` (category/unreadOnly filters, pagination), `PATCH
/notifications/[notificationId]` (mark read), `DELETE /notifications/[notificationId]`, `POST
/notifications/read-all`, `GET/PATCH /customer/notification-preferences`, `POST
/customer/push-tokens`, `DELETE /customer/push-tokens/[token]`.

**Mobile app**: two new full-screen modals, matching the established `CateringModal` pattern for
any screen beyond the fixed 6-tab nav (spec § 44) — `NotificationCenterModal.tsx` (category-chip
filter row, unread badge, mark-all-read, tap-to-navigate via `NAVIGABLE_TABS`, live-refreshes on
`'NotificationCreated'` while open) and `NotificationPreferencesModal.tsx` (account-wide, not
restaurant-scoped — unlike every other modal in this app — 5 category toggles + 3 channel toggles,
each optimistic-update-then-PATCH). `RestaurantHomeScreen` gained a bell button with an unread-count
badge (loads on mount, increments live on `'NotificationCreated'`, refetches on modal close);
`ProfileScreen` gained "View notifications" / "Notification settings" entry points.

**Backend verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 8
baseline (`git stash -u`; 3,507, matching the figure Phase 8 itself recorded). After Phase 9: 3,519,
+12 net, two genuinely new categories found and fixed rather than accepted. `TS2339` in
`PromotionCampaignService.ts`: a ternary (`accountIds.length === 0 ? [[], new Set()] : await
Promise.all([...])`) let TypeScript infer the empty-array branch's element type as `{}`, losing all
field information on the non-empty branch's result too; fixed by replacing the ternary with an
explicit type annotation and an `if` block instead of relying on inference across both branches.
`TS2345` in `lib/notifications/customer-app-settings.ts`: a defaults constant typed `number | null`
(to match the settings interface) was passed directly into a `number`-typed parameter even though
its literal value is never actually null; fixed with `?? 21`/`?? 8` nullish coalescing at the call
site rather than loosening the parameter's type. After both fixes, remaining categories are the
same established noise as every prior phase: `TS7026`/`TS7006` implicit-any, `TS2307`
module-not-found, `TS2882` `server-only` side-effect imports, `TS2591` missing globals, `TS7031`/
`TS2503`/`TS7053` from the same missing-`node_modules` root cause.

**Mobile verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 8
baseline (`git stash -u`; 126, matching the figure Phase 8 itself recorded). After Phase 9: 146
before fixes, one genuinely new category (`TS2322`) found and fixed the same way Phase 8's own
instance of it was: `CategoryChip` was invoked with `key` passed directly on the custom component
inside `NotificationCenterModal.tsx`'s category-filter row, instead of on a wrapping `<View>` per
this codebase's established convention (`ItemCustomizationModal.tsx`, and Phase 8's own
`PromotionCard`/`ClaimCard` fix); fixed by wrapping each `CategoryChip` in a keyed `<View>`. After
the fix: 144, remaining categories the same established noise as every prior phase: `TS7006`
implicit-any, `TS2307` unresolved `react-native`/`@react-navigation` imports, `TS2741` JSX
children-prop, `TS2591` missing `process.env` typing, `TS7053`.

Same no-test-runner gap as every prior CAPP phase — flagged, not silently skipped. Same
no-scheduler gap as every prior phase that needed one (Phase 14's reminder job, now also this
phase's `dispatchQueued`) — a real, staff-triggerable entry point exists; nothing invokes it on a
timer, because no cron/queue infrastructure exists in this sandbox to invoke it with.

## 19. Phase 10 implementation record — Loyalty, favorites, reordering, upselling (spec § 37-40, § 45, § 57)

**Scope boundary, decided before writing any code**: same check as every prior CAPP phase —
`git show --stat` against Phases 1-9's own first commits confirms none of them touched
`app/dashboard/**`. Phase 10 follows that boundary too: staff-facing configuration (menu-item
recommendations) reuses the existing `MENU_MANAGE`/`MENU_VIEW` permissions rather than a new one —
this is menu configuration, not a new concern — and every new table is reachable by staff only via
API, not a new dashboard page. No new staff dashboard UI ships this phase.

**`LoyaltyAccount` scoping decision**: keyed per `(organizationId, customerAccountId)`, i.e.
restaurant-specific — spec § 37's "Restaurant-specific loyalty programs," unlike
`CustomerNotificationPreference` (Phase 9), which is deliberately account-wide across every
restaurant on the platform. `lib/loyalty/loyalty-settings.ts` mirrors
`lib/notifications/customer-app-settings.ts`'s exact "JSON column supplies defaults" pattern:
`Organization.customerAppSettings.loyalty` defaults to `{currencyPerPoint: 50, tiers: [{BRONZE,0},
{SILVER,500},{GOLD,2000},{PLATINUM,5000}]}` when unset.

**Tier never demotes**: `LoyaltyAccount.tier` is derived from `lifetimePoints` (monotonically
increasing, never decremented by a redemption), not from `pointsBalance` (which does decrease on
redemption) — spending points can never knock a diner down a tier. A defensible UX choice, made
explicitly rather than left to fall out of whichever field happened to be convenient.

**Race-safe points redemption**: `LoyaltyService.redeemPoints` uses `tx.loyaltyAccount.updateMany({
where: {id, pointsBalance: {gte: points}}, data: {pointsBalance: {decrement: points}} })` — the same
"atomic op with a WHERE-clause floor guard, not read-then-write" idiom already established by
`NotificationDispatchService` and `PromotionService.recordRedemption`'s atomic-increment-then-check
for `redemptionCount`.

**`LOYALTY_REWARD`/`LOYALTY_TIER` — the two Phase 8 stubs are now real**. `Promotion` gained
`loyaltyPointsCost Int?` (required only for this discount type, enforced via a Zod cross-field
`.refine()` in `lib/validation/promotion.ts`, not a DB constraint).
`PromotionService.assertTypeSpecificEligibility` now checks the cost is configured and the customer
has enough points; `computeDiscount` treats it as a flat peso amount (same convention as
`FIXED_AMOUNT`); `recordRedemption` calls `LoyaltyService.redeemPoints` inside the same
order-creation transaction, re-validated fresh rather than trusting the earlier pre-transaction
check. `AudienceResolver`'s `RESOLVERS.LOYALTY_TIER` queries `prisma.loyaltyAccount.findMany({where:
{organizationId, tier}})` directly — genuinely points-based, distinct from `bySegment`'s RFM-based
`LOYAL` audience type.

**Scope line — promotion + loyalty-points stacking is structurally "OR," not configurable**: spec
§ 37 says "Promotion + loyalty points... must be configurable." Since this build already restricts
an order to at most one promotion redemption (a Phase 8 constraint) and `LOYALTY_REWARD` is just one
more `PromotionDiscountType`, stacking is always "OR" by construction — flagged here as an honest
scope decision rather than a silently-invented config toggle that would have implied a stacking mode
this codebase doesn't actually support.

**Points earning trigger**: wired into `OrderService.updateStatus`'s existing `COMPLETED`
transaction block, the same spot Accounting posting and Inventory consumption already happen.
Earns on `subtotal - discountTotal` (excludes tax/delivery fee, mirroring how Accounting already
separates those); a no-op for guest orders with no `customerAccountId`. Three new realtime event
types (`LoyaltyPointsEarned`, `LoyaltyTierChanged`, `LoyaltyRewardRedeemed`) fire alongside, each
with `notification: {category: 'LOYALTY', ...}` — activating Phase 9's previously-unused
`CustomerNotificationPreference.allowLoyalty` toggle for the first time.

**`CustomerFavorite` — one unified table, not two**: matches spec § 40's own singular
`customer_favorites` table name. Nullable `menuItemId`/`orderId` columns, enforced mutually
exclusive via a hand-authored Postgres `CHECK` constraint
(`customer_favorites_item_xor_order_check`) — the same XOR pattern already precedented by the base
platform's `journal_entry_lines_debit_xor_credit_check`. Two `@@unique([customerAccountId, X])`
compound indexes rely on Postgres treating each `NULL` as distinct in a unique index, so favorite-item
rows (`orderId` always null) and favorite-order rows (`menuItemId` always null) never spuriously
collide — no special-casing needed. Exposed as two separate endpoints/response shapes
(`FavoriteMenuItem`/`FavoriteOrder`) — the mobile client never needs to know they share a table.

**`MenuItemRecommendation` — staff-authored upselling**: self-referencing on `MenuItem` via two
named Prisma relations, with label/optional bundlePrice/displayOrder/active, reusing
`MENU_MANAGE`/`MENU_VIEW` rather than a new permission. `RestaurantDirectoryService.getPopularItems`
is the real-data complement (spec § 45's "Popular products") — a genuine `orderItem.groupBy` over
non-cancelled orders in a trailing 30-day window, not a duplicate of the manually-curated
recommendation table: a "Popular" row with nothing actually ordered yet returns empty, matching this
codebase's "no fake data" discipline throughout.

**Reorder preview — read-only, deliberately not authoritative**: `CustomerOrderService.previewReorder`
never places an order; it returns an availability-annotated, cart-shaped preview of a past order.
Enriches each modifier with *live* current name/price where the modifier is still active, falling
back to the original order's own snapshot for one that's been deactivated since (so the client can
still show what was ordered even though it can't be re-added) — same "preview, then an independently
authoritative checkout re-validates everything" split as `PromotionService.validateAndPreviewDiscount`.
Deliberately does not re-validate modifier-group required/minSelect/maxSelect cardinality — group
composition rarely changes, and the real checkout call (`OrderService.resolveAndPriceItems`) catches
it authoritatively if it ever does.

**Mobile — MenuScreen**: a heart-icon toggle on each `MenuItemRow` (only rendered when signed in —
favoriting is inherently tied to a `CustomerAccount`, but the menu itself stays fully browsable
logged out), calling the new `POST`/`DELETE .../favorites` endpoints.

**Mobile — the upselling interstitial**: implemented inside the existing `ItemCustomizationModal`
as a post-add-to-cart `stage: 'upsell'` sub-screen (not a separate modal) — directly matching spec §
39's own worked example of a suggestion appearing right after ordering. A failed/empty recommendation
fetch just closes the sheet normally; upselling is a bonus, never a blocker.

**Mobile — OrdersScreen "Order again" / "Favorite this order"**: each history row gained a
reorder button (calls the preview endpoint, prices each `available: true` item as `base price + sum
of its modifiers' price deltas` — matching how `ItemCustomizationModal.handleAdd` already computes
`unitPriceCents`, since `CartLineItem.unitPriceCents` is a single all-inclusive figure, not
base-plus-a-separate-modifiers-total — pushes them into `CartContext`, then switches the tab to its
cart view) and a favorite-order heart toggle, both loaded/kept in sync against the new
`favorites/orders` endpoints.

**Mobile — LoyaltyModal / FavoritesModal**: two new full-screen modals (`src/screens/loyalty/`),
matching the established `NotificationCenterModal` pattern for a screen that doesn't fit the fixed
6-tab nav (spec § 44 lists LOYALTY as "Optional," not one of the six). `LoyaltyModal` is purely
informational (points/tier/progress/transaction history) — there's no "redeem" action in it, since
redemption only ever happens as a `LOYALTY_REWARD` promotion applied at checkout, not a wallet spent
from directly. `FavoritesModal` has two tabs (Items/Orders) backed by the two favorites endpoints;
"Add to cart" for a favorite item is a deliberately simplified one-tap add at the item's base price
with no variant/modifier picker (a diner wanting to customize can still tap through from the Menu
tab), while "Order again" for a favorite order reuses the same reorder-preview flow as OrdersScreen's
own button. Both open from new "Loyalty status" / "Favorites" entries on `ProfileScreen`, replacing
its former "Loyalty rewards are coming in a later update" placeholder note.

**Mobile — RestaurantHomeScreen**: spec § 45's other two Home Screen items. A compact "Loyalty
status" pill (tier + points, shown once signed in, tapping it opens the same `LoyaltyModal`) and a
horizontal "Popular products" strip from the new public `menu/popular` endpoint. Spec § 45's third
item, "Recent orders," is intentionally not duplicated here — the Orders tab's Order History one tab
over already is that exact view, and repeating it on Home would just be the same data shown twice.

**Backend verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 9
baseline (`git stash -u`; 3,519, matching the figure Phase 9 itself recorded). After Phase 10: 3,557,
same 10 categories as baseline (`TS7026`, `TS7006`, `TS2307`, `TS2882`, `TS2591`, `TS7031`, `TS2503`,
`TS7053`, `TS2345`, `TS18046`) at proportionally higher counts — zero genuinely-new categories, no
fixes needed this time (unlike Phases 8/9, which each found and fixed 1-2 new-category issues).

**Mobile verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 9
baseline (`git stash -u`; 144, matching the figure Phase 9 itself recorded). After Phase 10: two
genuinely new problems found and fixed before the diagnostic-diff was clean — neither was a
`tsc`-only nitpick, both were real bugs:
`ItemCustomizationModal.tsx`'s `stage === 'upsell' ? <UpsellView .../> : (<ScrollView>...</ScrollView>
<View style={styles.footer}>...</View>)}` parenthesized the `'form'`-stage branch around *two*
sibling elements with no wrapping parent, which is invalid JSX, not just a type error (`TS2657`,
"JSX expressions must have one parent element") — fixed by wrapping that branch in a `<>...</>`
fragment, the same shape `UpsellView`'s own two-sibling return already used correctly.
`RestaurantHomeScreen.tsx`'s popular-items strip destructured the `.map()` callback parameter
(`.map(({ menuItem }) => ...)`) against a `PopularMenuItem[] | null` state variable narrowed via a
`popularItems && popularItems.length > 0` condition — TypeScript's contextual typing for a
*destructured* callback parameter didn't survive that narrowing chain the way a plain named
parameter would have (`TS7031`, binding element implicitly `any`), even though the exact same
destructuring pattern is unproblematic elsewhere in this codebase on a non-nullable array
(`MenuScreen.tsx`'s `item.modifierGroups.map(({ modifierGroup }) => ...)`); fixed by using a plain
named parameter (`.map((popular) => ...)`) instead of destructuring, sidestepping the inference gap
rather than fighting it. After both fixes: 165, remaining categories the same established noise as
every prior phase: `TS7006` implicit-any, `TS2307` unresolved `react-native`/`@react-navigation`
imports, `TS2741` JSX children-prop, `TS2591` missing `process.env` typing, `TS7053`.

## 20. Phase 11 implementation record — Analytics: promotion ROI, customer engagement, sales attribution (spec § 29-30, § 55-57)

**Scope boundary, decided before writing any code**: same check as every prior CAPP phase —
`find app/dashboard` confirms no `app/dashboard/**` page exists for campaigns or promotions (only
`analytics`, `catering`, `customers`, `delivery`, `finance`, `inventory`, `invoices`, `kitchen`,
`menu`, `my-deliveries`, `notifications`, `orders`, `reports`, `reservations`, `settings`, `tables`),
matching Phase 8's own documented reasoning (`PROMOTION_MANAGE` and `BRANDING_MANAGE` have existed
since Phase 1/8 with no dashboard page ever built for either). Phase 11 follows the same boundary:
five new staff-gated read API endpoints, zero new dashboard UI.

**`CustomerAnalyticsEvent` scoped to exactly six event types** — `APP_OPENED`, `RESTAURANT_VIEWED`,
`MENU_VIEWED`, `PROMOTION_VIEWED`, `PROMOTION_CLICKED`, `REORDER_TAPPED` — deliberately not the full
spec § 57 list. "Order/Reservation started/completed," "Promotion claimed/redeemed," and "Loyalty
reward used" already have authoritative rows elsewhere (`Order`, `Reservation`, `CustomerPromotion`,
`PromotionRedemption`, `LoyaltyTransaction`); logging them a second time would be the duplicate
system the spec's own top-level instructions warn against. The full funnel-step-to-table mapping is
documented in both `schema.prisma`'s model comment and `PromotionAnalyticsService`'s header comment.
Privacy-conscious per spec § 57's own instruction: no IP, device fingerprint, or location is ever
stored; `customerAccountId` is nullable (every event type can fire pre-login, since this app never
gates browsing behind auth); `menuItemId`/`promotionId` are loose non-FK string columns, the same
"display/analytics only" shape already established by `CustomerNotification.relatedEntityId`.

**A real, first-time "open rate" signal, not a fabricated one**: `NotificationDelivery.openedAt` was
previously written by nothing anywhere in the codebase — Phase 9 only ever wrote `DELIVERED`/`SENT`/
`FAILED`, since no provider webhook exists to confirm delivery for PUSH/EMAIL/SMS. This phase wires
`openedAt` for the one channel that genuinely can be confirmed: `CustomerNotificationService.markRead`/
`markAllRead` now also set `NotificationDelivery(channel: 'IN_APP').openedAt` when a diner actually
taps into their notification-center entry. `markAllRead`'s two updates run inside one `$transaction`
array with the delivery-open update deliberately *first* — it filters on
`customerNotification: {isRead: false}}`, so running the `isRead` flip first would make every row in
that batch already read `isRead: true` by the time the delivery query ran, silently no-op-ing the
whole batch's open-tracking; a bug caught and fixed before it shipped, documented inline at the call
site.

**`CustomerPromotionStatus` semantics, correctly reverse-engineered from `PromotionService`**:
`claim()` creates a row with status `AVAILABLE`, not `CLAIMED`; `recordRedemption` sets it to
`CLAIMED` (redeemed at least once, more uses remain on a multi-use promo) or `REDEEMED` (fully
exhausted). So for analytics, spec § 29's funnel "Claimed" step = any `CustomerPromotion` row
existing at all for that promotion, while "Redeemed" = status IN (`CLAIMED`, `REDEEMED`) — the
inverse of what the enum value names suggest. Documented in `PromotionAnalyticsService`'s header
comment to prevent a future misread.

**Revenue and cost definitions reused, not reinvented**: "net sales" in the sales-attribution report
reuses `AccountingService.recordOrderRevenue`'s own formula (`subtotal - discountTotal + deliveryFee`)
— the same figure the books already recognize on order completion, not a second, competing
definition. "Promotion Cost" in the ROI dashboard is honestly redefined as "Discount Given" —
this platform has no separate marketing-spend/ad-cost tracking, so
`estimatedRoi = (revenue - discountGiven) / discountGiven` is documented as a deliberate,
narrower-than-ideal equivalence, not a silently-assumed broader cost model. Both reports reuse
`ReportingService.resolveReportDateRange` and `lib/validation/reporting.ts`'s
`reportDateRangeQuerySchema` (re-exported as `analyticsQuerySchema`) rather than a third date-range
parser, and the two org-wide reports reuse `ANALYTICS_VIEW` (Phase 12's owner-analytics permission)
rather than inventing a new one — `PROMOTION_MANAGE` covers only the campaign/promotion-scoped
reports, which are about a specific campaign or promotion, not the whole customer-app funnel.

**Honest data-gap flagging, per the master spec's "Do not fake promotional analytics"**: every
analytics response includes a `dataGaps: string[]` array naming exactly what can't be measured and
why — `reservationConversions`/`cateringConversions` are always `0` (`PromotionRedemption` has no
`reservationId`/`cateringInquiryId` column; only order-checkout redemption is wired, per Phase 8's
own documented scope line), `deliveryRate`/`openRate` for PUSH/EMAIL/SMS are dominated by IN_APP
(no provider webhook exists for the others), and `refunds`/`paymentFeesAvailable` are both `null`
(this platform has no order-refund workflow and no payment gateway at all, consistent with the base
platform's own "Do not fake payments" discipline).

**API surface** (all staff-facing routes gated by permission, all new):
`GET /api/campaigns/:campaignId/analytics` (`PROMOTION_MANAGE`) — spec § 55 Campaign Analytics:
audience size, notifications sent, delivery/open rate, channel breakdown, and — via a shared
`getPromotionEngagementForAccounts` helper — claimed/redeemed/orders/revenue/discount-cost/repeat-
customers scoped to the campaign's own audience.
`GET /api/promotions/:promotionId/analytics` (`PROMOTION_MANAGE`) — spec § 29/§ 30's funnel and ROI
dashboard, org-wide (not audience-scoped): `customersReached` is the union of campaign-audience and
claimed account IDs; `estimatedRoi` per the Discount-Given definition above.
`GET /api/analytics/customer-engagement` (`ANALYTICS_VIEW`, date-ranged) — spec § 57's event-type
counts plus order/reservation/catering/loyalty-redemption counts in one report.
`GET /api/analytics/sales-attribution` (`ANALYTICS_VIEW`, date-ranged) — spec § 56's gross/net sales,
discounts, and promotion-attributed share.
`POST /api/v1/restaurants/:id/analytics/events` (customer-facing) — the one route in this codebase
that accepts a signed-in-or-anonymous caller by design: calls `getCustomerSession` directly rather
than `requireCustomerAuthenticated`, since it already returns `null` gracefully with no token.

**Mobile — `useAnalyticsEvent()` hook** (`src/analytics/useAnalyticsEvent.ts`): a thin, best-effort
POST wrapper (failures are swallowed, matching this app's existing push-token-registration
discipline) wired into four screens at their natural funnel points — `RestaurantHomeScreen`
(`APP_OPENED` once per app session via a module-level flag, `RESTAURANT_VIEWED` on every restaurant
identity change), `MenuScreen` (`MENU_VIEWED` on mount, not on every refetch — the screen already
refetches on `MenuItemAvailabilityChanged`, which would defeat a "viewed" metric if it re-fired),
`PromotionsScreen` (`PROMOTION_VIEWED` once per promotion the first time it appears, guarded by a
ref-based seen-ID set so realtime-triggered refetches don't re-log it; `PROMOTION_CLICKED` at the
"Save offer" tap itself, before the claim call resolves — matching spec § 29's funnel ordering of
"Clicked" before "Claimed"), and `OrdersScreen`/`FavoritesModal` (`REORDER_TAPPED` in both
`handleReorder` and `orderAgain` — the same funnel step reached from two different entry points).

**Backend verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 10
baseline (`git stash -u`; 3,557, matching the figure Phase 10 itself recorded). After Phase 11:
3,576, same 10 categories as baseline (`TS7026`, `TS7006`, `TS2307`, `TS2882`, `TS2591`, `TS7031`,
`TS2503`, `TS7053`, `TS2345`, `TS18046`) at proportionally higher counts for the three categories new
code actually touches (`TS7006` +11, `TS2307` +6, `TS2882` +2 — new files' own unresolved-module and
implicit-any noise from this sandbox's missing `node_modules`/generated Prisma client) — zero
genuinely-new categories, no fixes needed.

**Mobile verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 10
baseline (`git stash -u`; 165, matching the figure Phase 10 itself recorded). After Phase 11: 166 —
one genuinely new line, `useAnalyticsEvent.ts`'s own `TS2307` "Cannot find module 'react'," the same
missing-`node_modules` noise every other file in this sandbox already reports; every other diff line
is an unchanged pre-existing error shifted by the new import/hook lines added above it, not a new
problem. No fixes needed.

Same no-test-runner gap as every prior CAPP phase — flagged, not silently skipped.

## 21. Phase 12 implementation record — Security / Performance / Testing / App Store preparation / Production deployment (spec § 62)

**Scope boundary, decided before writing any code**: same CAPP-only check as every prior phase —
this pass audits and hardens the customer-app API surface (`app/api/v1/**`, `services/customer/**`,
`services/crm/CustomerService.ts`, `services/promotions/**`) and the mobile app itself
(`/root/customer-app`), not the staff dashboard or its own Phase 15/16 hardening (already done, see
`docs/deployment/`). Where a finding's real fix would also touch staff auth or dashboard code (see
per-account login lockout, below), it's documented and deferred rather than half-applied to only one
audience.

**Security audit** (read-only subagent, CAPP-scoped, re-read actual transaction/query code rather
than trusting prior-phase doc comments): one real finding. `middleware.ts`'s
`RATE_LIMITED_AUTH_PREFIXES` only ever listed the staff auth routes (`/api/auth/login`,
`/api/auth/register`); the customer app's own login/register live under a different prefix
(`/api/v1/auth/login`, `/api/v1/auth/register`), so `'/api/v1/auth/login'.startsWith('/api/auth/login')`
is `false` and customer auth silently fell through to the generic 120 req/min `/api/*` bucket instead
of the intended 10 req/min brute-force-resistant one — twelve times looser than intended, and
`CustomerAccountService.login` has no other lockout to fall back on. Fixed by adding the `/api/v1/
auth/**` prefixes. A second, smaller gap — no per-account lockout, only IP-keyed rate limiting (this
platform has never had one, staff or customer side) — is documented in `middleware.ts` as a known,
accepted limitation rather than silently ignored: fixing it is a real feature (a failed-attempt
counter, an account-lock state, an unlock flow) that belongs to both auth surfaces at once, not a
CAPP-scoped patch bolted on asymmetrically for just the mobile app.

**Performance audit** (parallel read-only subagent, CAPP-scoped): three real findings, all fixed.
(1) `AudienceResolver`'s `bySegment`/`INACTIVE_DAYS` resolvers called `CustomerService.getAnalytics`
(six queries, including irrelevant favorite-items data) once per *candidate* customer — for a 5,000-
customer segment audience, roughly 30,000 queries to resolve one campaign's audience. Fixed with a
new `CustomerService.getRfmBatch(organizationId, customerIds)`, computing the same
`{recencyDays, frequency, monetary, segment}` shape for the whole candidate set in three queries
total (`Order.groupBy`, `CateringEvent.findMany`, one `Organization` lookup for RFM thresholds), reused
by both resolvers. `CustomerService.segmentBreakdown` (the CRM dashboard's own per-org segment count)
was deliberately left untouched — bounded by org size, a dashboard read, not a hot campaign-send path,
per its own existing comment. (2) Three CAPP list endpoints had no pagination at all —
`GET .../favorites`, `.../favorites/orders`, `.../promotions/mine` — each returning every row for an
account with no `take`/`skip`. Fixed by adding `listFavoritesQuerySchema`/`listMyPromotionsQuerySchema`
(both re-exporting the existing `paginationQuerySchema` convention) and wiring `take`/`skip` through
each service method and route handler; defaults apply even for the current mobile client, which
doesn't yet send either param. (3) `PromotionCampaignService.send()` wrote one `NotificationDelivery`
row per audience member inside its `$transaction`, each a separate `createMany` call. Fixed by
collecting all delivery rows into one array and issuing a single batched `createMany` after the loop,
plus a `{timeout: 30_000}` transaction option as a safety margin for large audiences. The loop's own
per-recipient `CustomerNotification` write and realtime-event dispatch remain architecturally
per-member — documented inline as inherent to a build with no queue/worker infrastructure, not a
silently-accepted miss.

**Testing gap closed**: CAPP Phases 7-11 shipped with zero integration test coverage. Before writing
new tests, `tests/helpers/db.ts`'s `resetDatabase()` — never updated since Phase 8 — was missing
`deleteMany()` calls for every Phase 8-11 table (`Promotion`, `PromotionCampaign`, `CampaignAudience`,
`CustomerNotification`, `NotificationDelivery`, `CustomerPromotion`, `PromotionRedemption`,
`LoyaltyAccount`, `LoyaltyTransaction`, `CustomerFavorite`, `MenuItemRecommendation`,
`CustomerAnalyticsEvent`, `CustomerPushToken`) — a real gap that would have leaked state between any
new test run, caught and fixed (correct FK-safe order, worked out from `schema.prisma`, before it
could silently corrupt results) rather than discovered after the fact. Four new integration test files
(13 tests) cover the master spec's explicit "Do not" invariants that had never been exercised:
`promotion-redemption.test.ts` (org-wide and per-customer `usageLimit` enforcement, cross-restaurant
promo isolation), `campaign-optout.test.ts` (account-level and per-channel opt-out enforcement,
including that a post-send opt-out doesn't retroactively rewrite an already-delivered row),
`loyalty-redemption.test.ts` (over-redemption rejection, genuine concurrent-redemption race safety via
three parallel `$transaction` calls against one 100-point balance — exactly one succeeds, balance never
goes negative), `promotion-analytics.test.ts` (real, order-math-matching ROI/revenue figures, honest
`dataGaps` reporting, cross-restaurant analytics isolation).

**App Store preparation (mobile)**: deep linking is now real — `useDeepLinkRestaurant`
(`src/restaurant/useDeepLinkRestaurant.ts`) listens for both cold-start (`Linking.getInitialURL`) and
warm-start (`Linking.addEventListener('url', ...)`) links, parses spec § 5's `/r/:publicCode` path via
`expo-linking`'s `Linking.parse`, and calls `RestaurantContext.loadRestaurant` directly — wired as a
plain effect in `App.tsx`'s `Bootstrap`, not through React Navigation's `linking` prop, since
`RootNavigator` is a plain conditional render on `RestaurantContext` state, not a route-based
navigator (mirrors exactly what `RestaurantCodeEntryScreen`'s manual submit already did).
`app.json` gained a `capp://` custom scheme (verifies immediately, no domain needed) plus
`associatedDomains`/`intentFilters` against a placeholder production domain (`app.example.com`,
explicitly flagged via `"// ..."` comment-keys) — real Universal/App Link verification needs
`apple-app-site-association`/`assetlinks.json` served from a real domain this build doesn't have; see
the new `docs/deployment/capp-mobile.md` for that as a deploy-time step, not a code gap. `eas.json` is
new (`build.{development,preview,production}` + `submit.production`), deliberately never run against
real EAS servers or populated with real Apple/Google credentials (no network access in this sandbox).
`src/legal/legalLinks.ts` adds `TERMS_URL`/`PRIVACY_URL` (env-var-backed, default `null`) and
`RegisterForm`'s Terms/Privacy acceptance text became real tappable links when set, falling back to
plain non-interactive text — never a dead link — when not; both required by App Store/Play Console
review, not just spec § 6's own registration-gating requirement. `customer-app/README.md`, stale since
Phase 2 (still described Promotions/Orders/Reservations as "coming in Phase N"), was brought current:
status, feature summary, the "What's deliberately not wired yet" list (rewritten — deep linking itself
is done; domain verification, store credentials, app icons, and legal pages are the honest remainder),
and the project-layout diagram (added `cart/`, `realtime/`, `analytics/`, `legal/`, and the full
`screens/` subtree that didn't exist at Phase 2).

**Production deployment hardening**: `CUSTOMER_AUTH_SECRET` was already present in
`lib/config/env.ts`'s eager-validation required set and `.env.example` (added back in CAPP Phase 1,
for the same reason `AUTH_SECRET` is required — the customer app's entire auth surface depends on it)
— verified, not re-added. What was genuinely missing: the base platform's own `docs/deployment/
production-checklist.md` never mentioned `CUSTOMER_AUTH_SECRET` in its step-3 required-vars list
despite `env.ts` already enforcing it, a doc/code drift now fixed (including the "must differ from
`AUTH_SECRET`" constraint from `lib/customer-auth/session.ts`). `docs/deployment/README.md`'s "Mobile
strategy" section was stale in a different way — written before CAPP existed, it said "no native
mobile app was built in this project," true only for the staff dashboard; rewritten to distinguish the
two apps rather than silently misdescribe the newer one. New: `docs/deployment/capp-mobile.md`, a full
EAS build/submit addendum — backend prerequisites, mobile env configuration, the deep-link
domain-verification steps from the App Store section above, store-credential setup, and build/submit/
rollback — explicitly marked reviewed-but-unrun, same disclosure as the rest of this directory.

**Backend verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 11
baseline (`git stash -u`; 3,576, matching the figure Phase 11 itself recorded). After Phase 12: 3,593
— same 10 categories as baseline, zero new ones, all growth in the three sandbox-noise categories new
files/lines touch (`TS7006` +9, `TS2307` +4, `TS2591` +4 — implicit-any params and unresolved-module
noise from missing `node_modules`, proportional to the four new test files and the pagination/
batching diffs). One genuinely-new-looking error surfaced mid-work — `getRfmBatch`'s `Map` inferred as
`Map<string, {}>` (`TS2339` on `_count`/`_sum`/`_min`/`_max`) — caught by an intermediate targeted
`tsc` check before it could reach this final diff, fixed with an explicit `OrderStatRow` type
annotation (the same missing-`node_modules` inference workaround `PromotionCampaignService.send`
already uses), and confirmed gone in the number above.

**Mobile verification**: `tsc --noEmit` diagnostic-diff against a freshly-regenerated Phase 11
baseline (`git stash -u`; 166, matching the figure Phase 11 itself recorded). After Phase 12: 171 —
same categories as baseline plus proportional growth (`TS2307` +3 for `useDeepLinkRestaurant.ts`'s
`expo-linking`/`react` imports and `legalLinks.ts`'s `react-native` import; `TS2591` +2 for
`legalLinks.ts`'s `process.env` reads), all the same missing-`node_modules` noise every file in this
project already reports. One real implicit-`any` caught and fixed before it reached this count —
`useDeepLinkRestaurant.ts`'s `addEventListener('url', (event) => ...)` callback parameter — annotated
`(event: { url: string })`, matching `expo-linking`'s own event shape, so `TS7006`'s count stayed flat
at 81 rather than growing. No other fixes needed.

Same no-test-runner gap as every prior CAPP phase — flagged, not silently skipped. This closes the
CAPP task list (spec § 62, Phases 1-12); phase-by-phase implementation records are §§ 10-21 above.
