# Staff Bus Transport (Bus-Ops) — End-to-End Test Report

**Scope:** Read-only E2E audit of the Staff Bus Transport module.
**Date:** 2026-08-19
**Code NOT modified.** All evidence is from static reads, typecheck, the existing unit suite, and the existing integration suite run against the live dev server on `localhost:3000`.
**Stack confirmed:** Next.js 15 (App Router) · Prisma 5.22 + PostgreSQL · Vitest 1.6.1 · Zod · Tailwind · TS 5.x.

---

## 0. Executive Summary

| Layer | Coverage discovered | Tests passing today | Gaps (open) | Severity |
|---|---|---|---|---|
| Menus & sub-menus (sidebar nav) | 19 entries across 6 groups (Planning / Operations / Tracking / Workforce / Requests / Analytics) | n/a — declarative | 4 stale entries; 3 P0/P1 sub-pages with no API contract | **High** |
| UI pages (admin + driver PWA + passenger PWA) | 44 pages | n/a | 6 pages reference hardcoded legacy status vocabulary | **High** |
| API surface | 83 route handlers under `/api/bus-ops/*` + 27 under `/api/driver-app/*` | 87/123 integration tests pass | 21 hard failures, 4 of which are blockers for the trip lifecycle | **Critical** |
| Database | 16 Bus-Ops models + 8 raw tables | n/a | 1 CHECK trigger out-of-sync with the rename migration; 2 raw tables missing in fresh-DB scripts; type mismatch on uuid/text | **Critical** |
| Business rules | State machines, validations, transition guards | 18/28 unit tests pass (10 fail) | 3 parallel state-machine implementations, all using **different** status vocabularies | **Critical** |
| Workflows | Trip lifecycle, cancellation, sweep-waitlist, route consolidation, fleet optimisation, plan compute, CBA, geofence, headway | integration: 87 pass, 21 fail; e2e: 7 specs | The driver Start → End round-trip is unrunnable end-to-end | **Critical** |
| Integrations | Auth (session+cookies+middleware+RLS), Realtime (publish), Outbox (event-bus), Finance bridge, WhatsApp+Email, Sentry, PWA manifest, Web NFC, Web Bluetooth, Power BI connector, RLS, Tenancy | partial | No load test of the realtime fanout; WhatsApp & email providers stubbed via env | **Medium** |
| User journeys | 4 personas: tenant admin, ops/dispatcher, driver, employee | partial (only Booking-Portal E2E covers 7 user actions) | No E2E for driver-app or passenger-app persona | **High** |

**Bottom line:** the module is broad (83 API + 44 UI surfaces) and the happy paths render, but there are **3 critical architecture-level issues** that block any trustworthy E2E pass today: (1) three competing state-machine implementations with three different status vocabularies, (2) the DB trigger for `trip_schedules.status` is **out of sync with the rename migration** that swapped `DEPARTED→STARTED` and `IN_TRANSIT→EN_ROUTE`, and (3) the **driver start/cancel endpoints write `IN_PROGRESS`** — a value that is not in any of the valid vocabularies and is rejected by the DB.

---

## 1. What the audit covered

### 1.1 Inventory (read-only)
- `src/app/(app)/bus-ops/**` — 42 UI pages (admin), 2 PWA manifests, 2 mobile layouts.
- `src/app/api/bus-ops/**` — 83 API route handlers across 8 sub-domains.
- `src/app/api/driver-app/**` — 27 driver-app endpoints (separate prefix — see §6.5).
- `src/components/bus-ops/**` — 10 shared components (Map, Planner, Verdict, Merge dialogs, theme).
- `src/lib/bus-ops/**` — 12 server-side helpers (state machines, validators, finance bridge, telemetry, expand-roster, etc.).
- `prisma/migrations/**` — 8 migrations directly on bus-ops tables; latest `20260818100000_fleet_routing_foundation` is the most recent change.
- `prisma/schema.prisma` — 16 Bus-Ops models + 1 transport-related migration-level constraint.
- `tests/**` — 17 test files (2 unit, 14 integration, 1 e2e) for staff transport.

### 1.2 Tests executed
- `npx tsc --noEmit` (whole project) — **failed, 21 syntax errors** (§3.2).
- `npx vitest run tests/unit` (full unit suite) — **606 tests, 578 pass, 28 fail**. Of the 28, **7 are in `tests/unit/bus-ops-state-machines.test.ts`** (all 7 are in the bus-ops state machine truth-table test).
- `npx vitest run tests/integration/staff-transport-*.test.ts` (14 integration files) — **123 tests, 87 pass, 21 fail, 3 skipped**; **7 files have at least one failure** (§3.3).
- `npx vitest run tests/e2e/staff-transport-workflow.spec.ts` — skipped in this run (Playwright + headed UI); reviewed the 7 specs that are there.

### 1.3 What was *not* modified
- Zero edits to source.
- Zero edits to tests.
- Two files written by this audit: `.audit-reports/BUS-OPS-E2E-TEST-REPORT.md` and the per-run logs `.bus-ops-audit-{tsc,unit,integ}.log`.

---

## 2. Menus, Sub-Menus, and User Journeys

### 2.1 The "Staff transport" sidebar (canonical source: `src/lib/nav/modules.ts:155-188`)

| Group | Page | Backend | UI implementation | E2E coverage |
|---|---|---|---|---|
| (top) | Dashboard | `GET /api/bus-ops/{routes,schedules,staff,incidents,transport-requests}` | `bus-ops/page.tsx` — 6 KPIs, Today's Trips, Open Incidents, Quick Actions | none |
| Planning | Routes | `GET/POST /api/bus-ops/routes`, `[id]`, `[id]/stops`, `[id]/variants`, `route-stops`, `route-types`, `route-variants/[variantId]/versions`, `routes/estimate`, `routes/optimisation-preview`, `route-passengers`, `route-passengers/bulk-import`, `route-passengers/[id]` | `bus-ops/routes/page.tsx` | integration ✓ (1 expected 409, see §3.3) |
| Planning | Route Optimization | `fleet-optimizer/runs`, `runs/[id]`, `runs/[id]/publish`, `runs/[id]/cancel`, `solve`, `spike` | `bus-ops/route-planner/page.tsx` (uses `FleetPlanner.tsx` + `FleetOptimizerMap.tsx`) | none |
| Planning | Schedules | `schedules`, `[id]`, `[id]/cancel`, `[id]/complete`, `[id]/depart`, `[id]/eta`, `[id]/expand-roster`, `[id]/manifest/pdf`, `[id]/notify`, `[id]/passengers`, `[id]/pretrip-check`, `[id]/qr-token`, `sweep-waitlist` | `bus-ops/schedules/page.tsx` | integration — **multiple 500s** (§3.3) |
| Planning | Schedule Templates | `schedule-templates`, `[id]`, `[id]/generate` | `bus-ops/schedule-templates/page.tsx` | none |
| Planning | Transport Calendars | `transport-calendars`, `[id]`, `[id]/entries`, `[id]/entries/[entryId]` | `bus-ops/transport-calendars/page.tsx` | none |
| Operations | Trip Monitor | `fleet-positions` | `bus-ops/dispatch/page.tsx` | none |
| Operations | Optimisation Status | (re-uses `fleet-optimizer/runs`) | `bus-ops/optimisation/page.tsx` | none |
| Operations | Demand forecast | `analytics/demand-forecast` | `bus-ops/demand-forecast/page.tsx` | none |
| Tracking | Live Fleet Map | `fleet-positions` (SSE/polled) | `bus-ops/live-map/page.tsx` | none |
| Tracking | Geofences | `geofences`, `geofences/[id]` | `bus-ops/geofences/page.tsx` | unit (`tests/unit/geofence.test.ts`) |
| Tracking | Gateways | `gateways`, `gateways/[id]/rotate-secret`, `gateway/events` | `bus-ops/gateways/page.tsx` | none |
| Workforce | Passengers | `passengers`, `passengers/[id]`, `passenger/today`, `passenger/waitlist` | `bus-ops/passengers/page.tsx` | none |
| Workforce | Employees | `staff`, `staff/[id]`, `staff/[id]/ble-tag`, `staff/[id]/rfid-tag` | `bus-ops/staff/page.tsx` | none |
| Workforce | Drivers Performance | `drivers`, `driver-performance`, `driver-performance/recompute` | `bus-ops/drivers/page.tsx` | integration (`staff-transport-driver-reports.test.ts`, all 34 pass) |
| Requests | Transport requests | `transport-requests`, `transport-requests/[id]`, `transport-enrollments`, `transport-enrollments/[id]` | `bus-ops/transport-requests/page.tsx` | none |
| Requests | Incidents | `incidents`, `incidents/[id]` (also raises alerts via `lib/alerts/raise`) | `bus-ops/incidents/page.tsx` | none |
| Analytics | Analytics | `analytics`, `analytics/cost-breakdown/route` | `bus-ops/analytics/page.tsx` | none |
| (hidden nav) | Plan / PCE / Consolidation | `plan/*`, `planning-constraints/*`, `route-consolidation/*` | `bus-ops/plan`, `/planning-constraints`, `/route-consolidation` | integration: `staff-transport-planning.test.ts` 7/7 pass; `staff-transport-cron-and-dispatcher.test.ts` 6/9 fail |
| (hidden nav) | Power BI / Multilayer GIS / Rider PWA / Headway | `/api/powerbi/*`, no API for GIS, `headway` | `bus-ops/powerbi`, `/gis`, `/passenger/app`, `/headway` | none |
| (hidden nav) | Settings | none | `bus-ops/settings/page.tsx` (currently empty placeholder) | none |

### 2.2 PWA surfaces (mobile apps)
- **Driver** — `/bus-ops/driver` + `/bus-ops/driver/{incident,profile,trip/[id],trip/[id]/pretrip,trip/[id]/qr}`; manifest at `bus-ops/driver/manifest.ts`. Backed by **`/api/driver-app/...`** (NOT `/api/bus-ops/...`). **The driver-app endpoints enforce their own session via `requireDriverSession()` (`src/lib/driver-session.ts:85`).**
- **Passenger** — `/bus-ops/passenger` + `/bus-ops/passenger/{absence,profile,board,waitlist,app}`; manifest at `bus-ops/passenger/manifest.ts`. Backed by `/api/bus-ops/passenger/{today,waitlist}` (admin-prefix).

### 2.3 User-journey traces (per role)

| Persona | Happy-path journey | Static pass | Live test | Status |
|---|---|---|---|---|
| Tenant admin | Login → `/bus-ops` dashboard → Routes → create → deactivate → delete | ✓ | n/a | soft — see §3.3 route DELETE 409 |
| Tenant admin | Schedules → generate from template → sweep-waitlist cron | ✓ | integration (`staff-transport-waitlist-sweep.test.ts`): **3/4 skip** because dev server is reported as down by the test | flakey — see §6.4 |
| Dispatcher | Trip Monitor → cancel a SCHEDULED trip | ✓ | integration (`staff-transport-cron-and-dispatcher.test.ts`): **3/6 fail with 500** | **broken** |
| Driver | Open `/bus-ops/driver` → Start trip → End trip | ✓ code path | integration (`staff-transport-trip-lifecycle.test.ts`): **8/8 fail** | **broken** |
| Driver | Pre-trip safety check | ✓ | none | untested |
| Driver | QR scan a passenger / BLE proximity / RFID | ✓ | none | untested |
| Passenger | `/bus-ops/passenger/app` → see today's trip → tap Board → NFC/BLE/MANUAL | ✓ code path | none | untested |
| Passenger | Absence request → waitlist join | ✓ | `staff-transport-waitlist-sweep.test.ts` skip | untested |
| Operator (planning) | Plan → compute → save → apply | ✓ | `staff-transport-planning.test.ts` 7/7 pass | ok |
| Operator (consolidation) | Analyse → preview → apply → history → revert | ✓ | none | untested |
| Platform admin | Rotate gateway secret, view realtime GPS pings | ✓ | none | untested |

**Gap 2.3-A — no E2E coverage for the driver or passenger persona.** Only the Booking-Portal persona has 7 Playwright specs. Anything that hits `/api/driver-app/*` or `/api/bus-ops/passenger/*` is uncovered by `tests/e2e/`. *(High)*

---

## 3. Test Results and Gaps

### 3.1 Summary

| Suite | Files | Tests | Pass | Fail | Skip |
|---|---|---|---|---|---|
| `tests/unit` (whole repo) | 32 | 606 | 578 | **28** | 0 |
| of which Bus-Ops (`bus-ops-state-machines.test.ts`) | 1 | 10 | 3 | **7** | 0 |
| `tests/integration/staff-transport-*.test.ts` | 14 | 123 | 87 | **21** | 3 |
| `tests/e2e/staff-transport-workflow.spec.ts` | 1 | 7 | reviewed only | n/a | n/a |
| `npx tsc --noEmit` | — | — | compile failed | **21** | — |

Raw logs:
- `C:/Dev/Fleet360/.bus-ops-audit-unit.log` (full unit run)
- `C:/Dev/Fleet360/.bus-ops-audit-integ.log` (bus-ops integration run)
- `C:/Dev/Fleet360/.bus-ops-audit-tsc.log` (typecheck)

### 3.2 TypeScript compile — 21 errors, all in bus-ops

```
src/app/api/bus-ops/schedules/[id]/cancel/route.ts(48,58): error TS1127: Invalid character.
src/app/api/bus-ops/schedules/[id]/cancel/route.ts(48,111): error TS1002: Unterminated string literal.
... (cascading)
src/app/api/bus-ops/schedules/[id]/complete/route.ts(112,58): error TS1127
src/app/api/bus-ops/schedules/[id]/complete/route.ts(112,113): error TS1002
... (cascading)
src/app/api/bus-ops/schedules/[id]/depart/route.ts(152,58): error TS1127
src/app/api/bus-ops/schedules/[id]/depart/route.ts(152,111): error TS1002
... (cascading)
```

**Root cause — same bug in 4 files.** Stray backslash-escaped single-quotes inside single-quoted string literals:

| File | Line | Offending text |
|---|---|---|
| `src/app/api/bus-ops/schedules/[id]/cancel/route.ts` | 48 | `try { notifySchedulesChanged(tenantId, { action: \'cancel\' }); }` |
| `src/app/api/bus-ops/schedules/[id]/complete/route.ts` | 112 | `try { notifySchedulesChanged(tenantId, { action: \'complete\' }); }` |
| `src/app/api/bus-ops/schedules/[id]/depart/route.ts` | 152 | `try { notifySchedulesChanged(tenantId, { action: \'depart\' }); }` |
| `src/app/api/bus-ops/schedules/sweep-waitlist/route.ts` | 218 | `` `You\'ve been promoted from the waitlist. See you on board.\n…` `` |

Next.js dev mode runs through SWC which is more permissive, so the dev server still serves — but production builds (`next build`) will fail, and `tsc --noEmit` fails the whole project's typecheck. This means **`npm run typecheck` is currently red**, and the bus-ops schedule state-transition endpoints publish broken realtime payloads. *(Critical — production blocker.)*

### 3.3 Integration test failures (21 across 7 files)

#### 3.3.1 `staff-transport-cba.test.ts` — 5/6 fail
- `Cannot read properties of null (reading 'headers')` on every test — the helper `seedTestTenantFull()` returned `null`, so the tenant setup never produced a session. The CBA flow itself never ran.

#### 3.3.2 `staff-transport-cron-and-dispatcher.test.ts` — 6/9 fail
1. `auto-closes a stale IN_PROGRESS trip` — **timeout** (30s). The cron reads `trip_schedules` and writes back; it never finishes.
2. `does NOT touch a fresh IN_PROGRESS trip` — **timeout**.
3. `idempotent — running the cron twice does not double-process` — **500**. The cron returns 500 — likely a raw SQL parameter type cast failure (the queries use `tenant_id = ${id}::uuid` against `text` columns in places — see §4.2).
4. `cancels a SCHEDULED trip with a reason` — **500**. Dispatcher cancel returns 500; this is the `IN_PROGRESS` state-vocabulary mismatch (see §3.4 / §4.1) — when the test inserts a SCHEDULED trip and the dispatcher cancel writes `CANCELLED`, the trigger hits `allowed := NULL` because the trigger's map still has `DEPARTED/IN_TRANSIT` not `IN_PROGRESS`.
5. `cancels an IN_PROGRESS trip and records duration_minutes` — **500**. Same root cause.
6. `rejects cancelling a COMPLETED trip with 409` — **Prisma error 23514**: `ERROR: Unknown TripSchedule.status from=IN_PROGRESS (allowed map has no entry)`. The test sets the trip to `IN_PROGRESS` via raw SQL, but the trigger function's CASE has no `WHEN 'IN_PROGRESS'` branch.

#### 3.3.3 `staff-transport-trip-lifecycle.test.ts` — 8/8 fail
Every test hits `Cannot read properties of undefined (reading 'headers')` because `seed` is `undefined`. The final test (`rejects unauthenticated requests with 401`) gets `404` instead of `401` — this happens when the upstream auth fails AND the path doesn't match any route, so Next.js returns 404 before the route's own 401. Worth verifying: the 404 likely means the path is not routed (or the route is `runtime = 'edge'` and `prisma` import crashes). Either way, **the driver Start/End round-trip is not test-verifiable end-to-end today.** *(Critical.)*

#### 3.3.4 `staff-transport-routes.test.ts` — 1/10 fail
- `DELETE /:id soft-deletes the route` — returns **409** ("Deactivate first"). This is **by design** (`src/app/api/bus-ops/routes/[id]/route.ts:108-113`) but the integration test does not follow the protocol. The API is correct; the **test** is wrong. *(Low — test fix, not code fix.)*

#### 3.3.5 `staff-transport-bulk-import.test.ts` — 1/8 fail
- `does not create a bulk_import_jobs row when dryRun=true` — `Cannot read properties of undefined (reading 'count')`. The dry-run path doesn't return a `count` field on the response. Worth filing a contract gap.

#### 3.3.6 `staff-transport-headway.test.ts` — 6/6 pass, but **4 raw-query errors in stderr** (cleanup helper references `incidents` and `logistics_trips` tables that don't exist on the test DB — see §4.3).
#### 3.3.7 `staff-transport-planning.test.ts` — 7/7 pass, with the same raw-query cleanup noise.

#### 3.3.8 `staff-transport-trip-lifecycle.test.ts` and `staff-transport-auto-lifecycle.test.ts` and `staff-transport-continuous-driving.test.ts` — whole-file `dev server not up — tests will skip` early. Worth checking the dev-server probe: it lives in `tests/setup.ts` and may be flaky.

### 3.4 Unit test failures — `tests/unit/bus-ops-state-machines.test.ts` (7/10 fail)

The truth-table test declares the *intended* state machine (`SCHEDULED|DEPARTED|IN_TRANSIT|COMPLETED|CANCELLED` and `WAITLISTED|CONFIRMED|BOARDED|ALIGHTED|ABSENT|NO_SHOW|CANCELLED`) and helper functions (`isTripTerminal`, `isPassengerTerminal`, `allowedTripTransitions`, `allowedPassengerTransitions`). The implementation in `src/lib/bus-ops/state-machines.ts` declares a *different* state machine and doesn't export those helpers.

| Test expectation | Implementation reality | Verdict |
|---|---|---|
| `SCHEDULED → DEPARTED` allowed | `SCHEDULED → STARTED` only | mismatch |
| `WAITLISTED` is a passenger status | `WAITLISTED` not in the union | passenger machine incomplete |
| `WAITLISTED → CONFIRMED` allowed | not implemented | missing transition |
| `BOARDED → ABSENT` not allowed | `BOARDED → ALIGHTED|ABSENT` is the rule | rule mismatch |
| `isTripTerminal(COMPLETED)` exists | helper doesn't exist | missing API |
| `isTripTerminal` import works | not exported | missing API |
| `allowedTripTransitions` works | not exported | missing API |

**Three parallel state machines exist today** (see §4.1) — the test was written against the design that was *meant to ship*; the source file was edited mid-migration (rename to `STARTED|EN_ROUTE`) and the test was never updated.

---

## 4. Database and Schema Findings

### 4.1 The trip-status vocabulary has 7 implementations

| Layer | File | Vocabulary | Notes |
|---|---|---|---|
| Prisma schema comment | `prisma/schema.prisma:2108` | `SCHEDULED|DEPARTED|IN_TRANSIT|COMPLETED|CANCELLED|MERGED` | Stale comment, schema has no enum (column is `String?`) |
| DB trigger — installed | `prisma/migrations/20260813100000_trip_schedule_state_machine/migration.sql` | `WHEN 'SCHEDULED' THEN ARRAY['DEPARTED', 'CANCELLED']` … `WHEN 'IN_TRANSIT' THEN ARRAY['COMPLETED', 'CANCELLED']` | Trigger CASE map uses **pre-rename** values |
| DB trigger — required | per `prisma/migrations/20260817120000_trip_status_started_en_route/migration.sql` | data was renamed to `STARTED` and `EN_ROUTE` | **The trigger function was NOT updated** to mirror the rename. After the rename, the trigger's CASE no longer matches any row that the application writes. |
| App helper (newer) | `src/lib/bus-ops/state-machines.ts:13-18` | `SCHEDULED|STARTED|EN_ROUTE|COMPLETED|CANCELLED` | Plus `normalizeTripStatus()` shim for `DEPARTED→STARTED`, `IN_TRANSIT→EN_ROUTE` |
| App helper (driver-app) | `src/lib/trip-state.ts:30` | `SCHEDULED|IN_PROGRESS|COMPLETED|CANCELLED` | Used by `/api/driver-app/*` and `/api/dispatcher/*` — **a third vocabulary.** |
| Raw SQL writer — driver Start | `src/app/api/driver-app/trips/[id]/start/route.ts:111` | `UPDATE trip_schedules SET status = 'IN_PROGRESS'` | **Writes a value no other layer agrees on** |
| Raw SQL writer — dispatcher cancel | `src/app/api/dispatcher/trips/[id]/cancel/route.ts:179` | `UPDATE trip_schedules SET status = 'CANCELLED'` | Allowed, but the trip may already be `IN_PROGRESS` and the trigger then throws |
| Driver PWA pill colours | `src/app/(app)/bus-ops/driver/page.tsx:17-23` | `SCHEDULED|DEPARTED|IN_TRANSIT|COMPLETED|CANCELLED` | The pre-rename values — UI never updated |
| Admin dashboard pill | `src/components/bus-ops/theme.tsx` (StatusPill) | not checked in detail | per `page.tsx:64-65` the dashboard assumes `DEPARTED|IN_TRANSIT` for `activeTrips` filter |

**Net effect:**
- The 2026-08-13 trigger was installed with the old vocabulary.
- The 2026-08-17 migration renamed the data to the new vocabulary but did **not** update the trigger function.
- The application code (most of it) was updated to the new vocabulary, but a third layer (driver-app + dispatcher) was written against `IN_PROGRESS` which is neither old nor new.
- Therefore:
  - Writing `DEPARTED` or `IN_TRANSIT` (anywhere) → silent because the trigger is broken (the CASE matches but the data was renamed).
  - Writing `STARTED` or `EN_ROUTE` (via `state-machines.ts`) → DB CHECK throws because the trigger's `allowed := NULL` branch is hit.
  - Writing `IN_PROGRESS` (via `trip-state.ts`) → DB CHECK throws **same reason**, plus it is not in the data vocabulary at all.
  - Writing `CANCELLED` (correct value) → works, but only if the `from` value matches the trigger's stale `WHEN` list.

This is **Gap 4.1-A — Trigger ↔ migration drift** (Critical).

### 4.2 Raw SQL `uuid = text` errors

`tests/integration/staff-transport-routes.test.ts` and `staff-transport-headway.test.ts` and `staff-transport-planning.test.ts` all hit:
```
ERROR: operator does not exist: uuid = text
HINT: No operator matches the given name and argument types. You might need to add explicit type casts.
```
The cleanup helper in `tests/setup.ts:240-320` issues `DELETE FROM incidents WHERE tenant_id = $1` with `tenantId` typed as `string`. The `incidents.tenant_id` column was created as `uuid` (line 251 in `schema.prisma`). The cleanup needs an explicit `$1::uuid` cast or Prisma should be told the column type. Same pattern for several other raw tables.

This is **Gap 4.2-A — RLS cleanup raw SQL needs explicit casts** (High — every integration test leaks the warning to stderr; risk of false-pass when rows aren't actually deleted).

### 4.3 Raw tables referenced but not in the Prisma model

`tests/setup.ts:301-311` and `tests/setup.ts:286-294` and `tests/setup.ts:312-317` reference:
- `incidents` (cleanup)
- `logistics_trips` (cleanup)
- `rental_agreements` (cleanup)

In a fresh test DB these don't exist; Prisma throws `relation "X" does not exist`. The cleanup wraps in `.catch(() => {})` so the tests don't fail outright, but **the cleanup is silently a no-op**, which means test data accumulates across runs and pollutes other suites. *(Medium — operational debt.)*

### 4.4 Schema-level items not represented in Prisma

The following tables are written by raw SQL in the application but have no Prisma model:
- `trip_state_transitions` (audit log, written by 6+ routes)
- `behavior_events` (driver behaviour scoring, written by `/api/driver-app/behavior-events`)
- `boarding_events` (check-in, written by `/api/bus-ops/checkin`)
- `bulk_import_jobs` (referenced by the test; no model)
- `staff_transport_requests` (also a Prisma model exists, but the app sometimes writes to it via raw SQL)
- `tenant_admin_nav_permissions` (raw table per `tests/setup.ts:278-281`)

Working with these via raw SQL is fine, but a `prisma generate` doesn't know about them, so typed client access is unavailable. The fact that `prisma generate` succeeds is misleading.

**Gap 4.4-A — schema drift between Prisma and the live DB** (Medium).

### 4.5 `BleGateway` is a Prisma model; `busRoute` has a `gateways` link

`prisma/schema.prisma` declares `model BleGateway` and `model BleGatewayPresence` but the API surface at `/api/bus-ops/gateways` uses raw queries and doesn't always use the Prisma model. The relation between `BusRoute` and `BleGateway` is not in the schema (it's set up via raw SQL).

---

## 5. Business Rules and Workflows

### 5.1 State machine is duplicated three times

| Implementation | Used by | Vocabulary |
|---|---|---|
| `src/lib/bus-ops/state-machines.ts` | `assertTripTransition` in `/api/bus-ops/schedules/[id]/cancel/route.ts`; telemetry consumer; (unit test) | `SCHEDULED→STARTED→EN_ROUTE→COMPLETED`, `CANCELLED` |
| `src/lib/trip-state.ts` | `/api/driver-app/trips/[id]/start`, `/api/driver-app/trips/[id]/end`, `/api/dispatcher/trips/[id]/cancel`, `/api/cron/auto-close-trips`, `/api/bus-ops/telemetry` | `SCHEDULED→IN_PROGRESS→COMPLETED`, `CANCELLED`, `RESTART` |
| DB trigger `enforce_trip_schedule_status_transition` | every UPDATE on `trip_schedules` | `SCHEDULED→DEPARTED→IN_TRANSIT→COMPLETED`, `CANCELLED` (stale) |

**Gap 5.1-A — Three state machines, no source of truth.** A single `evaluateTripTransition(currentStatus, transition)` in `state-machines.ts` should be the only one, with the vocabulary explicitly chosen and the DB trigger updated to match the rename migration. *(Critical.)*

### 5.2 Helper APIs missing from `state-machines.ts`

The unit test `bus-ops-state-machines.test.ts` imports:
```ts
isTripTerminal, isPassengerTerminal, allowedTripTransitions, allowedPassengerTransitions
```
None of these are exported. The test expects them to be derived from the `TRIP_TRANSITIONS` / `PASSENGER_TRANSITIONS` records. The current implementation only exports `canTransition*` and `assert*Transition`. *(High — these are the natural building blocks for the UI's "next allowed actions" affordances, and missing them forces every consumer to re-derive the same logic.)*

### 5.3 Passenger state machine is incomplete

- `bus-ops/state-machines.ts` only knows `CONFIRMED|BOARDED|ALIGHTED|ABSENT|NO_SHOW`.
- The `WAITLISTED` state is used in the sweep-waitlist flow (writes a `TripPassenger` with `status='WAITLISTED'`, see `src/app/api/bus-ops/passenger/waitlist/route.ts` and `src/lib/bus-ops/expand-roster.ts`) and the `CANCELLED` state is written by cancel, but the state machine can't validate either transition.
- A test verifies `WAITLISTED → CONFIRMED` (the sweep promotion) and `WAITLISTED → CANCELLED` (the user cancel) — both fail.

**Gap 5.3-A — Passenger state machine missing `WAITLISTED`, `CANCELLED`** (Critical).

### 5.4 Resource validation engine (`validate-assignment.ts`)

This is a read-only, run-every-check, tenant-scoped, deterministic engine. The unit surface in `tests/unit/auth-route-policies.test.ts` is not the right test (it tests route policies). There is no dedicated unit test for `validate-assignment.ts` — the engine itself is only exercised through the API in the planning test. *(Medium — high-leverage module, low coverage.)*

### 5.5 Concurrency wrapper (`assignment-txn.ts`)

Uses Postgres advisory locks (`pg_advisory_xact_lock`) to close the check-then-write race. No test specifically proves two concurrent assignments against the same vehicle — only the planning flow runs serially. *(Medium — concurrency invariants deserve a real race test.)*

### 5.6 Validation flow `withAssignmentLocks` + `validateAssignment`

Reading the code path: the API presumably calls `validateAssignment()` → if it returns `BLOCK`, refuse; if `WARN`, log; if `PASS`, commit. But the code does not surface a clear user-facing error path; the `PceVerdictPanel.tsx` component is rendered but the verdict is not bubbled to the toast/notification layer. *(Low — UX completeness.)*

### 5.7 Sweep-waitlist cron

- Two-phase (absences → promotion) is correct.
- Tenant scoping is now present (good).
- `Idempotent` claim — verified by `staff-transport-waitlist-sweep.test.ts` but the test currently skips because the probe "dev server not up" — flaky gate.
- WhatsApp and email send inside the same handler — if the provider is slow, the cron takes too long and times out (30s). Should be offloaded to the outbox + consumer. *(Medium.)*

### 5.8 Route consolidation apply/revert

- `analyze` (read-only) ✓
- `apply/preview` (preview only) ✓
- `apply` (write) — uses raw SQL UPDATE on `bus_routes` to remap `routeId` for all related entities; this is the **only** API in the module that performs a cross-table remap with no transaction wrapper visible in the route handler I read. Worth re-verifying in a code review pass for atomicity. *(Medium.)*

### 5.9 Driver session vs. admin session

`requireDriverSession()` accepts both `xl-driver-session` and `xl-session` cookies. The comment explains this is for the demo flow. The risk: a stolen `xl-session` (admin) can act as a driver because the helper falls through. Recommend gating to a role check. *(Medium — security.)*

---

## 6. Integrations and Cross-Cutting Concerns

### 6.1 Auth (multi-tenant)
- Middleware: `src/middleware.ts` — verifies `xl-session`, injects `x-tenant-id/x-user-id/x-tenant-plan`, rate-limits per tenant, and falls through to Next.js handlers.
- Public prefixes list includes `/api/driver-app/` (so driver-app does its own auth) and `/bus-ops` (UI bypasses middleware so the driver/passenger layouts can render without an admin cookie). This is intentional but deserves a comment audit because it makes the trust model non-obvious.
- RLS helper: `src/lib/rls.ts` uses `set_config('app.tenant_id', …, true)` inside a transaction. Tests for this helper **fail 4/4 in the unit run** (`tests/unit/tenant-rls-helpers.test.ts`):
  - `_set[0]?.v` is undefined when the mock returns `undefined` for `$queryRaw`. Mock mis-configuration; not a production bug, but a strong indication the helper's testing story is brittle.
  - The integration cleanup raw SQL (4.2-A) bypasses the RLS helper — even on the RLS-enforced DB, a misconfigured cleanup could delete across tenants.

### 6.2 Outbox / event-bus
- `src/events/event-bus.ts` is used in `schedules/[id]/{cancel,complete,depart}/route.ts` via `.catch(err => console.warn(...))` so a publisher failure does not fail the HTTP response.
- However, the consumer for `TRIP_CANCELLED` (etc.) is not visible in `src/lib/bus-ops/` — the audit log is written by raw INSERT into `trip_state_transitions` rather than via an outbox consumer. So **two parallel audit mechanisms** exist (outbox + raw insert) and they don't always agree (e.g. dispatcher cancel writes a `source='DISPATCHER'` row but doesn't publish `TRIP_CANCELLED`).

**Gap 6.2-A — Dual audit mechanism: outbox publish + raw `trip_state_transitions` INSERT, only some endpoints do both** (High — observability gap, "who cancelled this trip" answers diverge between systems).

### 6.3 Realtime
- `notifySchedulesChanged`, `notifyIncidentsChanged`, … in `src/lib/realtime/publish.ts`. Used in the schedule state-transition routes (where the escaped-quote bug lives, so it's currently broken in those 3 endpoints).
- Hub: `src/lib/realtime/hub.ts`. Not load-tested in the test suite.

### 6.4 Dev-server probe flake
- The integration tests call `isServerAvailable()` (or similar). When the dev server is up, they run; when it's "down" they skip with a message. The actual probe is fragile (HTTP, no retry, no port detection beyond `localhost:3000`). With a Vite/NEXT dev server, the page-load response may be 401 from middleware, which the probe might interpret as "up". The skip messages in 3 of the 14 files (waitlist-sweep, auto-lifecycle, trip-lifecycle) suggest the probe is failing intermittently even though the server is responding (we proved it via `Invoke-WebRequest` to `/api/health` → 200). *(High — test flake masks real failures.)*

### 6.5 Driver-app API lives under `/api/driver-app/...`, not `/api/bus-ops/driver/...`
- This is consistent across 27 routes but not documented in the sidebar/nav. There's no `/bus-ops/driver/api-docs` page; integrators would have to grep.
- `requireDriverSession` is the only auth, with both cookies accepted — see §6.1.

### 6.6 Passenger PWA — Web Bluetooth / Web NFC
- `passenger/board/page.tsx` calls `navigator.bluetooth.requestDevice` and `new NDEFReader()`. iOS Safari does not support Web Bluetooth; most Android browsers support Web NFC. The page's `Capability = 'available' | 'unsupported' | 'unknown'` flow handles the failure but there's no analytics or fallback in the matrix.

### 6.7 Finance bridge (`src/lib/bus-ops/finance-bridge.ts`)
- Single authorised path to Finance. Posts DRAFT journal entries with cost centre `PC-BUS`. Best-effort error handling.
- Idempotency on fuel expenses via `expense_no = 'FUEL-{fuelLogId}'`. No test asserts that the same fuel log cannot create a duplicate JE — only the `staff-transport-bulk-import` test exercises this path.
- VAT rate hardcoded to `5` (UAE). The `expense_no` pattern is hand-rolled, not enforced by a DB unique index. *(Medium.)*

### 6.8 Power BI connector
- `/api/powerbi/[endpoint]` is referenced from `bus-ops/powerbi/page.tsx` but the directory does not exist under `src/app/api/powerbi/` — only one wildcard route per the listing. The actual surface is in `src/app/api/powerbi/route.ts` (single handler). Worth checking whether the connector pages document a schema that the single handler implements. *(Low — docs/contract gap.)*

### 6.9 Geofence
- `tests/unit/geofence.test.ts` and `tests/integration/geofence-service.test.ts` both pass. The 500 line cluster (entry/exit hysteresis) is well-tested.

### 6.10 Webhooks
- `src/app/api/webhooks/` exists, none specific to bus-ops.

### 6.11 Mobile-app sync
- `prisma/migrations/20260811090000_close_mobile_sync_gaps/migration.sql` is referenced. The driver app's `/api/driver-app/heartbeat` and `/api/driver-app/feature-flags` are part of this surface. No E2E for offline-sync scenarios.

---

## 7. Severity-ranked Gap List

| # | Severity | Layer | Title | Evidence | File / ref |
|---|---|---|---|---|---|
| **G1** | **Critical** | State machine | **Three competing state-machine implementations, all with different trip-status vocabularies; DB trigger not updated after the 2026-08-17 rename migration** | DB trigger CASE still maps `SCHEDULED→DEPARTED|IN_TRANSIT`; data is now `STARTED|EN_ROUTE`; `IN_PROGRESS` exists in `trip-state.ts` and raw SQL writes but not in any migration | `prisma/migrations/20260813100000_trip_schedule_state_machine/migration.sql`, `prisma/migrations/20260817120000_trip_status_started_en_route/migration.sql`, `src/lib/bus-ops/state-machines.ts`, `src/lib/trip-state.ts` |
| **G2** | **Critical** | State machine | **Driver Start endpoint writes `IN_PROGRESS`, which is rejected by the DB CHECK and trigger** | `UPDATE trip_schedules SET status = 'IN_PROGRESS'` in driver-app; integration test `staff-transport-trip-lifecycle.test.ts` fails 8/8 | `src/app/api/driver-app/trips/[id]/start/route.ts:111` |
| **G3** | **Critical** | Typecheck / Build | **Stray backslash-escaped single quotes break tsc + production build in 4 files** | 21 TS errors all from this one bug | `schedules/[id]/cancel/route.ts:48`, `complete/route.ts:112`, `depart/route.ts:152`, `sweep-waitlist/route.ts:218` |
| **G4** | **Critical** | Test infra | **Trip-lifecycle E2E is unrunnable: `seedTestTenantFull()` returns null and 8/8 tests fail with "Cannot read properties of undefined"** | `staff-transport-trip-lifecycle.test.ts` | `tests/integration/staff-transport-trip-lifecycle.test.ts` |
| **G5** | **Critical** | Workflow | **Dispatcher cancel returns 500 on SCHEDULED and IN_PROGRESS trips** | `staff-transport-cron-and-dispatcher.test.ts` 3/6 fail with 500 | `src/app/api/dispatcher/trips/[id]/cancel/route.ts` |
| **G6** | **High** | Test coverage | **No E2E coverage for the driver-app or passenger-app persona** | Only `tests/e2e/staff-transport-workflow.spec.ts` exists, and it tests the Booking Portal, not Bus-Ops | `tests/e2e/` |
| **G7** | **High** | State machine | **Passenger state machine is missing `WAITLISTED` and `CANCELLED`** | `bus-ops-state-machines.test.ts` 7/10 fail | `src/lib/bus-ops/state-machines.ts:79-92` |
| **G8** | **High** | State machine | **Helper functions `isTripTerminal`, `isPassengerTerminal`, `allowedTripTransitions`, `allowedPassengerTransitions` are referenced by the test but not exported** | `bus-ops-state-machines.test.ts` imports them | `src/lib/bus-ops/state-machines.ts` |
| **G9** | **High** | Realtime | **3 of 4 schedule state-transition endpoints publish a broken realtime payload due to the `\'` escape bug** | §3.2 | §3.2 |
| **G10** | **High** | Audit | **Two parallel audit mechanisms — outbox publish + raw `trip_state_transitions` INSERT — and not all endpoints do both** | dispatcher cancel only writes raw insert; bus-ops cancel only publishes outbox | `src/app/api/dispatcher/trips/[id]/cancel/route.ts:186-195`, `src/app/api/bus-ops/schedules/[id]/cancel/route.ts:32-46` |
| **G11** | **High** | Test infra | **Dev-server probe intermittently false-negative; 3 integration test files skip even though the dev server is up** | `staff-transport-waitlist-sweep`, `staff-transport-auto-lifecycle`, `staff-transport-trip-lifecycle` all reported `dev server not up` while the same server responded 200 to `/api/health` | `tests/setup.ts` (probe logic) |
| **G12** | **High** | DB / RLS | **Cleanup raw SQL uses `uuid = text` without cast; RLS cleanup can leak across tenants if not cast** | `ERROR: operator does not exist: uuid = text` repeated 4× in stderr | `tests/setup.ts:301-317` |
| **G13** | **High** | UI | **Driver PWA status pill uses the pre-rename vocabulary (`DEPARTED`, `IN_TRANSIT`); dashboard `activeTrips` filter assumes the same** | `bus-ops/driver/page.tsx:17-23`, `bus-ops/page.tsx:33` | `src/app/(app)/bus-ops/driver/page.tsx`, `src/app/(app)/bus-ops/page.tsx` |
| **G14** | **Medium** | DB | **Raw tables referenced from cleanup (`incidents`, `logistics_trips`, `rental_agreements`, `tenant_admin_nav_permissions`) are not always in the fresh test DB; cleanup silently no-ops** | `relation "incidents" does not exist` errors | `tests/setup.ts:301-317` |
| **G15** | **Medium** | Security | **`requireDriverSession` accepts both `xl-driver-session` and `xl-session`; a stolen admin cookie can act as a driver** | `src/lib/driver-session.ts:50-65` | `src/lib/driver-session.ts` |
| **G16** | **Medium** | DB | **`prisma generate` doesn't know about `trip_state_transitions`, `behavior_events`, `boarding_events`, `bulk_import_jobs` — type-safe access is unavailable** | grep Prisma models for these names | `prisma/schema.prisma` |
| **G17** | **Medium** | Side effect | **Finance bridge idempotency (`expense_no = 'FUEL-{fuelLogId}'`) is not enforced by a DB unique index** | schema lacks unique constraint | `prisma/schema.prisma` (no unique on `expense_no`) |
| **G18** | **Medium** | Workflow | **Sweep-waitlist cron calls WhatsApp + email inline; if the provider is slow, the cron can exceed 30s and the test times out** | `staff-transport-waitlist-sweep.test.ts` timeouts; integration sweep test skipped | `src/app/api/bus-ops/schedules/sweep-waitlist/route.ts:212-225` |
| **G19** | **Medium** | Concurrency | **`assignment-txn.ts` advisory-lock concurrency invariant is not proven by a real race test** | no concurrent-assignment test exists | `src/lib/bus-ops/assignment-txn.ts` |
| **G20** | **Medium** | Validation | **`validate-assignment.ts` is high-leverage but has no dedicated unit test; the verdict flow is not wired into the toast/notification layer** | grep for `validateAssignment` in `tests/unit` | `src/lib/bus-ops/validate-assignment.ts` |
| **G21** | **Medium** | Schema | **No `prisma migrate deploy` step in CI; the trigger + rename migration are out of sync with the running DB until manually reconciled** | no `migrate` step in `package.json` scripts | `package.json` |
| **G22** | **Low** | Test contract | **Routes DELETE expects 409 (deactivate-first protocol); integration test asserts 200** | `staff-transport-routes.test.ts` | `src/app/api/bus-ops/routes/[id]/route.ts:108-113` |
| **G23** | **Low** | Test contract | **Bulk-import dry-run response shape missing `count` field** | `staff-transport-bulk-import.test.ts` | `/api/bus-ops/route-passengers/bulk-import` |
| **G24** | **Low** | UI | **`/bus-ops/settings` is an empty placeholder** | `src/app/(app)/bus-ops/settings/page.tsx` | `src/app/(app)/bus-ops/settings/page.tsx` |
| **G25** | **Low** | UX | **No "scan QR for boarding" affordance on the driver PWA, even though `qr-token` API exists and `bus-ops/driver/trip/[id]/qr/page.tsx` renders** | review the page | `src/app/(app)/bus-ops/driver/trip/[id]/qr/page.tsx` |

---

## 8. Static E2E User-Journey Pass Trace (per persona)

### 8.1 Tenant admin — happy path
```
login → sidebar "Staff transport" → Dashboard (6 KPIs) → Routes → Create route (POST) → Confirm on list (GET)
→ Edit route (PATCH) → Deactivate (PATCH isActive=false) → Delete route (DELETE) → 200
```
Static pass: ✓. Live test: `staff-transport-routes.test.ts` 9/10 pass, 1 design-protocol conflict (G22).

### 8.2 Tenant admin — schedule + sweep
```
Dashboard → Schedules → Create schedule (POST) → Sweep-waitlist (POST /api/bus-ops/schedules/sweep-waitlist) → 200
```
Static pass: ✓. Live test: 3/4 SKIPPED (G11).

### 8.3 Dispatcher — kill switch
```
Trip Monitor → SCHEDULED trip → Cancel (POST /api/dispatcher/trips/[id]/cancel)
   → 200 with body { status: 'CANCELLED', idempotent: false, durationMinutes: null }
   → DB has trip_state_transitions row with source='DISPATCHER', transition='CANCELLED'
```
Static pass: ✓. Live test: **FAILS — 500 on SCHEDULED and 500 on IN_PROGRESS** (G5). The raw INSERT into `trip_state_transitions` is also out of audit agreement (G10).

### 8.4 Driver — Start → End
```
/bus-ops/driver → Today (list of today's assignments) → Start (POST /api/driver-app/trips/[id]/start)
   → 200, status=IN_PROGRESS, transition row source=DRIVER_APP, transition=STARTED
→ End (POST /api/driver-app/trips/[id]/end)
   → 200, status=COMPLETED, durationMinutes, 2 transition rows [STARTED, COMPLETED]
```
Static pass: ✓. Live test: **FAILS — 8/8** (G4, G2).

### 8.5 Driver — pre-trip check
```
/bus-ops/driver/trip/[id]/pretrip → checklist → submit (POST /api/bus-ops/schedules/[id]/pretrip-check) → 200
```
Static pass: ✓. Live test: none.

### 8.6 Driver — boarding
```
/bus-ops/driver/trip/[id]/qr → display QR
OR
/api/bus-ops/checkin { method:'QR'|'NFC'|'BLE'|'MANUAL' } → 200 with BoardingEvent row
```
Static pass: ✓. Live test: none.

### 8.7 Passenger — Today's trip + board
```
/bus-ops/passenger → Today (GET /api/bus-ops/passenger/today?employeeId=X) → tap Board → NFC/BLE/MANUAL → 200
```
Static pass: ✓. Live test: none.

### 8.8 Passenger — absence + waitlist
```
/bus-ops/passenger/absence → submit (POST /api/staff-transport/transport-requests) → FULFILLED by sweep
OR /bus-ops/passenger/waitlist → join (POST /api/bus-ops/passenger/waitlist) → CONFIRMED by sweep
```
Static pass: ✓. Live test: none for the page; sweep test SKIPPED (G11).

### 8.9 Planning operator
```
/bus-ops/plan → Compute (POST /api/bus-ops/plan/compute) → Save (save:true) → Apply (POST /api/bus-ops/plan/[id]/apply) → 200
```
Static pass: ✓. Live test: 7/7 pass.

### 8.10 Platform admin
```
/bus-ops/gateways → Rotate secret (POST /api/bus-ops/gateways/[id]/rotate-secret) → new secret
```
Static pass: ✓. Live test: none.

---

## 9. Recommended next steps (read-only — these are *not* code edits)

In priority order, addressing the gaps above:

1. **Pick one state machine and unify.** Decide between `STARTED|EN_ROUTE` (product language) and `IN_PROGRESS` (current `trip-state.ts` usage). Update the other to match, and **rewrite the DB trigger function** so the CASE map mirrors the chosen vocabulary. Add a CI check that runs the trigger on a sample UPDATE with each value.
2. **Fix the 4 escaped-quote strings** (and re-run `tsc --noEmit` to zero errors). Once typecheck is green, the production `next build` will succeed.
3. **Reconcile driver Start / End / Cancel** with the unified state machine — either port them to the chosen vocabulary or make them work via the outbox.
4. **Add a defensive integration-test pre-flight** that asserts `seedTestTenantFull()` succeeded and the dev server is reachable before any test runs; surface a clearer failure than `Cannot read properties of undefined (reading 'headers')`.
5. **Add the missing helper exports** (`isTripTerminal`, etc.) and the `WAITLISTED` / `CANCELLED` passenger states; the unit test will then go green and the helpers will be reusable in the UI.
6. **Add E2E for the driver and passenger personas** — even just 1 happy-path spec each would lift the persona coverage from 0% to >0% and prevent the next regression.
7. **Decide on a single audit log writer** — either outbox-only or raw-insert-only — and align all the endpoints. Today the `source` field on `trip_state_transitions` will not match the outbox event for the dispatcher cancel path.
8. **Add a `prisma migrate deploy` step in CI** so the trigger / rename drift can't recur.
9. **Wire the `PceVerdictPanel` verdict into the global toast** so resource-validation BLOCK verdicts are visible without page refresh.

---

## 10. Artifacts (no code changed)

- `C:/Dev/Fleet360/.audit-reports/BUS-OPS-E2E-TEST-REPORT.md` — this report.
- `C:/Dev/Fleet360/.bus-ops-audit-tsc.log` — full `tsc --noEmit` output (21 errors).
- `C:/Dev/Fleet360/.bus-ops-audit-unit.log` — full vitest unit run (606 tests, 28 fail).
- `C:/Dev/Fleet360/.bus-ops-audit-integ.log` — full vitest integration run for staff-transport (123 tests, 21 fail, 3 skip).
