# Logistics Go Backend Migration (L0–L4c) — Completion Record

Compiled 2026-09-12 by direct inspection of git history, the live Railway
deployment, and CI run history — not from prior documentation. Where
evidence is incomplete, that is stated explicitly rather than inferred.

**Updated 2026-09-13** (sections 2 and 3 only): a Go backend service was
deployed to Railway on this date, resolving the "no active deployment"
finding below. See the updated sections for what changed and, just as
importantly, what still has not been verified as a result.

## 1. Original milestone scope → current implementation

Commit `5e750b32` ("feat(backend): migrate Logistics API surface into the
Go backend (L0–L4c)", 2026-06-23) declared this scope. It is fully merged
into `main` — `main` is 691 commits ahead of that commit with none unique
to it, and `backend/` has grown since (see below).

| Original scope (5e750b32) | Current state |
|---|---|
| Pure packages: `routeopt`, `distmatrix`, `geo`, `geofence`, `ledger`, `rateengine`, `etapredict` | Present in `backend/`, unit-tested, unchanged in kind |
| Shipment orders; carriers/bids/RFQs/rate contracts (marketplace) | Present (`handlers/logistics_marketplace.go`) |
| Trips/stops/tracking/ePOD | Present (`handlers/logistics_execution.go`, `logistics_tracking.go`) |
| Finance: charges/settlements/postings | Present (`handlers/logistics_finance.go`) |
| Analytics: SLA monitor, driver stats, tracking | Present (`logistics_sla.go`, `logistics_driver_stats.go`, `logistics_analytics.go`) |
| L4c VRP planner: optimize/inputs/plans/commit/discard/edit + geocoder | Present (`handlers/logistics_planner.go`, `logistics_geocoder.go`) |
| **Not in the original scope, added since**: `logistics_accessorial.go`, `logistics_stats.go`, `logistics_spot_test.go` | Present — the backend has continued to grow past L4c under normal `main` development |
| **L4d (decommission the old Next.js routes)** | **Not started.** `src/lib/api-shim.ts` still proxies only an explicit allowlist; every non-allowlisted logistics path still has a live Next.js implementation. This was always the stated plan ("additive strangler cutover... decommissioned later (L4d) only after parity is verified") — L4d is outstanding, not broken. |

## 2. Active deployment revisions

**Next.js (`fleet360-app`)** — Railway project `fleet360-railway`
(`ac5b8297-816b-44d3-bb61-41f079e92faa`), confirmed live via `railway
status --json` and a direct HTTP request:

| Environment | Domain | Commit | Status |
|---|---|---|---|
| production | `fleet360-app-production.up.railway.app` | `edc839ee` (PR #63 merge) | SUCCESS, active |
| staging | `fleet360-app-staging.up.railway.app` | `edc839ee` | SUCCESS, active |

`https://fleet360-app-production.up.railway.app/` → HTTP 200 (checked
2026-09-12). Note: a separate Vercel project (`fleet360`) also exists for
this repo and is stale (last successful-looking alias 13+ days old at the
time of checking, every deployment attempt since has ended in Vercel's
own "Error" status). Railway is the platform actually serving traffic for
this app; Vercel appears abandoned or mid-migration-away-from. This
discrepancy is itself worth resolving (an unused deploy target still
consuming CI minutes and secrets) but is separate from this record.

**Go backend — superseded 2026-09-13, see below.** At compile time
(2026-09-12), no active deployment existed anywhere in this Railway
account. All 5 projects were checked:

| Project | Service | Repo | Status (as of 2026-09-12) |
|---|---|---|---|
| `fleet360-railway` | `fleet360-app` (the Next.js service above) | `ajithalex2004/Fleet360` | active — Node/Next.js only, no Go component |
| `beautiful-liberation` | `LogiXL-Connect` | `ajithalex2004/LogiXL-Connect` | Go binary, port 8080 — **but a different repo**; FAILED, 0 active instances, last deploy 2026-02-19 |
| `beneficial-emotion` | `LimoXL-Connect` | `ajithalex2004/LimoXL-Connect` | Go binary — different repo; FAILED, 0 active instances |
| `earnest-solace` | `Carwash` | `ajithalex2004/Carwash` | FAILED, 0 active instances |
| `alert-enthusiasm` | — | — | empty project |

`LogiXL-Connect` was the closest name/shape match (Go, port 8080) but
deploys from an unrelated repository with its own mobile-app-flavored
commit history, and had been dead since February. At that time, this
repo's `backend/` Go code — the actual L0–L4c implementation — had no
corresponding running deployment anywhere in this Railway account.

### 2026-09-13 update: a Go backend is now deployed

A new service, `fleet360-backend`, was created directly in the existing
`fleet360-railway` project (same project as `fleet360-app`), running this
repo's `backend/` Dockerfile. Getting it to a stable state required
finding and fixing two real bugs, in sequence:

1. **Build-time**: `backend/Dockerfile` pinned `FROM golang:1.21-alpine`
   while `go.mod` requires `go >= 1.25.0` — the build failed outright.
   Fixed by bumping the builder image tag (merged via PR #65).
2. **Runtime, production-only**: `objectstore.Init()`
   (`backend/objectstore/store.go`) requires `S3_ENDPOINT`,
   `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` to be set, and
   `backend/main.go`'s `runServer()` treats init failure as fatal
   whenever `GO_ENV=production` (the Dockerfile's baked-in default) —
   deliberately, per that function's own comment: "accepting uploads
   against a broken storage backend is worse than refusing to boot."
   Without those variables, the container logged `starting HTTP server`,
   then `object store init failed`, then exited — before ever binding
   port 8080 — on every restart, indefinitely. A Cloudflare R2 bucket
   (`fleet360-uploads`) and a scoped Object-Read-&-Write API token were
   created to supply real values. That surfaced a second, more specific
   error: `objectstore: client init: Endpoint url cannot have fully
   qualified paths` — the MinIO SDK requires `S3_ENDPOINT` as a bare
   hostname, not a full `https://` URL. Fixing that value resolved it.

Confirmed directly via the Railway GraphQL API (not inferred): deployment
`8022ed16-6d23-45a7-8192-d683d84d716b`, created 2026-09-13T16:50:30Z,
status `SUCCESS`, with no subsequent restart. Its logs show, in order,
`phasegate: cross-tenant isolation VERIFIED` → `starting HTTP server` →
`object store ready` → `/healthz` — the first time this container reached
a healthy state. The service has no public `staticUrl` (confirmed via the
same API) — by design, it is reachable only over Railway's private
network, and `fleet360-app`'s `GO_BACKEND_URL` variable is confirmed set
to `http://fleet360-backend.railway.internal:8080`, matching that.

## 3. One successful authenticated logistics request through the shim

**As of 2026-09-12: not produced, and not currently producible**, for the
reasons below (preserved as originally written, since they were true at
the time). **As of the 2026-09-13 update in section 2: the specific
infrastructure blockers this section identified are resolved, but an
actual authenticated end-to-end request has still not been executed or
confirmed against production — that remains a real gap, not something to
assume succeeds just because its prerequisites now do.**

`fleet360-app` production's environment variables (checked by name via
`railway variable --service fleet360-app --environment production`) do
include a valid-looking `JWT_SECRET` — a fresh finding that **corrects an
earlier claim in this investigation** that `JWT_SECRET` was absent from
production (that check was against the stale Vercel project, not the
live Railway one). At the time of the original writing, `GO_BACKEND_URL`
was absent from that same variable list, and `src/lib/api-shim.ts` fell
back to `http://localhost:8080` when unset, with nothing listening there.

**2026-09-13: both of those specific conditions have changed.**
`GO_BACKEND_URL` is now confirmed set to
`http://fleet360-backend.railway.internal:8080`, and a Go instance is now
confirmed listening on the other end (section 2). Separately, PR #64
removed four paths (`/api/logistics/tracking`, `/rfqs`, `/shipments`,
`/carriers`) from the shim's allowlist — they had been marked as
migrated while no backend existed, which meant any authenticated request
to them would 502; removing them restored their existing Next.js
implementations as the active path. The current allowlist
(`MIGRATED_EXACT_PATHS`: `analytics`, `driver-stats`, `rates/quote`,
`sla`; `MIGRATED_PREFIXES`: `planner`, `carrier-portal/app`,
`driver-app`) is what would now route to the live Go backend for an
authenticated caller — **but no such request has actually been made and
observed to succeed** as part of this record. That verification is the
concrete next step, not yet done.

Direct, unauthenticated confirmation (2026-09-12): `GET
https://fleet360-app-production.up.railway.app/api/logistics/sla` → HTTP
401, returned by Next.js's own auth check before the shim ever runs —
consistent with every unauthenticated logistics path, migrated or not,
and thus unable to distinguish shim success from shim failure by itself.
This unauthenticated check was not re-run after the 2026-09-13 changes
since it cannot, by its nature, answer the question that matters now.

**Conclusion, stated as a structural fact rather than an inferred one, as
of 2026-09-12**: any authenticated request to a "migrated" logistics path
in production would fail at the shim's `fetch()` call against an
unreachable `localhost:8080`, surfacing as `api-shim.ts`'s `502 { error:
"Backend unavailable" }`. **As of 2026-09-13, that specific failure mode
is no longer expected to occur** (the backend is reachable at the
configured URL), but this record does not claim to have confirmed a
successful authenticated response in its place — only that the previously
identified blocking cause is gone.

## 4. Missing/invalid authentication and cross-tenant rejection results

This is verified at the **code/CI level**, against the **same commit
(`edc839ee`) currently deployed to Railway** — not against a live Go
instance, because none exists to test against (see section 2 and 3).

CI run `34601878168` (triggered by the `edc839ee` merge, 2026-09-11) —
job **"Cross-tenant isolation"** (`.github/workflows/phase0.yml`,
`backend/phasegate` Go package) — **passed**:

```
ok  	fleet360-backend/phasegate	0.005s
```

including, by name, in that run's test list:
`TestIntegration_RlsIsolation_Vehicles`,
`TestIntegration_RlsIsolation_Drivers`,
`TestIntegration_RlsIsolation_Garages`,
`TestIntegration_RlsIsolation_RoleIsEnforcing`,
`TestIntegration_TestTenantIsolation_Vehicles/Drivers/Garages`,
`TestIntegration_TestTenantIsolation_RejectsBuggyQuery`,
`TestMiddleware_Returns503WhenUnverified`,
`TestMiddleware_PassesThroughWhenVerified`.

Per `backend/phasegate/rls_isolation.go`'s own design (see that file's
header comment), these specifically prove Postgres RLS itself — not just
application-side `WHERE tenant_id = ?` filtering — is enforced for the
tables it covers, and separately prove the connected role isn't
`BYPASSRLS` (which would make every vector pass for the wrong reason).

**Caveat, stated plainly**: the named test vectors cover core fleet
tables (vehicles, drivers, garages), not the logistics-specific tables
this migration added. I found no `phasegate` test file specific to
`logistics_*` tables — `auth.WithTenant`'s own fail-closed `1=0` design
(documented in `backend/auth/scope.go`) is the mechanism logistics
handlers rely on, and it is exercised by ordinary handler tests
(`logistics_test.go`, `logistics_planner_test.go`), but I did not find
the same rls_isolation-style *behavioral RLS proof* extended to a
logistics table specifically. Missing/invalid-authentication behavior
(a request with no or malformed Bearer JWT) is covered by
`TestMiddleware_Returns503WhenUnverified` /
`TestMiddleware_PassesThroughWhenVerified` for the JWT-verification
gate itself, at the middleware level, not per-logistics-handler.

## 5. Classification Matrix for the 15 Logistics Routes (2026-09-15)

In earlier iterations (2026-09-12), 15 routes registered under `backend/main.go` were documented as un-shimmed or undetermined. An audit and live production probe on 2026-09-15 across both canary (`35ad69c6...`) and non-canary control (`fc057fdc...`) tenants established their exact status, callers, and classifications.

### A. Summary Matrix

| Route (Go `/api/v1/...`) | Shim Status (`api-shim.ts`) | Go Handler | Next.js Equivalent Route | Live Production Status (Canary / Control) | Final Classification |
|---|---|---|---|---|---|
| `/logistics/stops` | **Shimmed** (`MIGRATED_PREFIXES`) | `GetLogisticsStops`, `CreateLogisticsStop` | Nested: `/shipments/[id]/stops` | HTTP 200 (`go`) / HTTP 404 (`none`) | **Go-Native Execution Route** |
| `/logistics/route-legs` | **Shimmed** (`MIGRATED_PREFIXES`) | `GetLogisticsRouteLegs`, `CreateLogisticsRouteLeg` | None | HTTP 200 (`go`) / HTTP 404 (`none`) | **Go-Native Execution Route** |
| `/logistics/assignments` | **Shimmed** (`MIGRATED_PREFIXES`) | `GetLogisticsAssignments`, `CreateLogisticsAssignment` | Nested: `/shipments/[id]/assign` | HTTP 200 (`go`) / HTTP 404 (`none`) | **Go-Native Execution Route** |
| `/logistics/tracking-events` | **Shimmed** (`MIGRATED_PREFIXES`) | `GetLogisticsTrackingEvents`, `CreateLogisticsTrackingEvent` | None | HTTP 200 (`go`) / HTTP 404 (`none`) | **Telemetry & Ingest Endpoint** |
| `/logistics/pod-events` | **Shimmed** (`MIGRATED_PREFIXES`) | `GetLogisticsPodEvents`, `CreateLogisticsPodEvent` | None (Next uses `/trips/[id]/pod`) | HTTP 200 (`go`) / HTTP 404 (`none`) | **Telemetry & Ingest Endpoint** |
| `/logistics/telematics-events` | **Shimmed** (`MIGRATED_PREFIXES`) | `GetLogisticsTelematicsEvents`, `CreateLogisticsTelematicsEvent` | `/telematics/stream` | HTTP 200 (`go`) / HTTP 404 (`none`) | **Telemetry & Ingest Endpoint** |
| `/logistics/exceptions` | **Shimmed** (`MIGRATED_PREFIXES`) | `GetLogisticsExceptions` | None | HTTP 200 (`go`) / HTTP 404 (`none`) | **Go-Native Execution Route** |
| `/logistics/bids` | **Shimmed** (`MIGRATED_PREFIXES`) | `GetLogisticsBids`, `CreateLogisticsBid` | Nested: `/rfqs/[id]/bids` | HTTP 200 (`go`) / HTTP 404 (`none`) | **Marketplace Spot Route** |
| `/logistics/carrier-scorecards` | **Shimmed** (`MIGRATED_PREFIXES`) | `GetLogisticsCarrierScorecards`, `CreateLogisticsCarrierScorecard` | None | HTTP 200 (`go`) / HTTP 404 (`none`) | **Marketplace Spot Route** |
| `/logistics/freight-charges` | **Shimmed** (`MIGRATED_PREFIXES`) | `GetLogisticsFreightCharges` | None | HTTP 200 (`go`) / HTTP 404 (`none`) | **Finance Read Surface** |
| `/logistics/rate-contracts` | **Un-shimmed** | `GetLogisticsRateContracts`, `CreateLogisticsRateContract` | `/api/logistics/rates/contracts` | HTTP 404 (`none`) / HTTP 404 (`none`) | **Path Discrepancy (Next.js Active)** |
| `/logistics/carrier-settlements` | **Un-shimmed** | `GetLogisticsCarrierSettlements` | Internal `domain.ts` (Next: `/settlements`) | HTTP 404 (`none`) / HTTP 404 (`none`) | **Finance Read Surface (Go-Native)** |
| `/logistics/driver-payouts` | **Un-shimmed** | `GetLogisticsDriverPayouts` | Internal `domain.ts` | HTTP 404 (`none`) / HTTP 404 (`none`) | **Finance Read Surface (Go-Native)** |
| `/logistics/finance-postings` | **Un-shimmed** | `GetLogisticsFinancePostings` | Internal `domain.ts` | HTTP 404 (`none`) / HTTP 404 (`none`) | **Finance Read Surface (Go-Native)** |
| `/logistics/finance/reconciliation` | **Un-shimmed** | `GetLogisticsFinanceReconciliation` | Internal `domain.ts` | HTTP 404 (`none`) / HTTP 404 (`none`) | **Finance Read Surface (Go-Native)** |

---

### B. Detailed Architectural Findings

1. **The 10 Shimmed Routes (Go-Native Execution & Ingest)**:
   - These 10 paths were incorporated into `MIGRATED_PREFIXES` in `src/lib/api-shim.ts`.
   - In production, canary tenants receive `HTTP 200` with `x-backend: go`.
   - Control non-canary tenants receive `HTTP 404` (`x-backend: none`) because Next.js has no top-level handlers for `/api/logistics/stops`, `/route-legs`, `/tracking-events`, etc. (Next.js implements execution endpoints under nested routes like `/shipments/[id]/stops`).
   - These routes query the Phase L2 and Phase L3 Postgres tables (`logistics_stops`, `logistics_route_legs`, `logistics_assignments`, `logistics_tracking_events`, `logistics_pod_events`, `logistics_telematics_events`, `logistics_exceptions`, `logistics_bids`, `logistics_carrier_scorecards`, `logistics_freight_charges`) behind `auth.WithTenant`.

2. **The Rate Contracts Path Discrepancy**:
   - Go registers `/api/v1/logistics/rate-contracts` (`handlers.GetLogisticsRateContracts`).
   - Next.js UI (`src/app/(app)/logistics/rate-contracts/page.tsx`) queries `/api/logistics/rates/contracts/route.ts`.
   - Because of this naming divergence, `/api/logistics/rates/contracts` is kept deliberately on Next.js (`x-backend: none`, HTTP 200).
   - If `/api/logistics/rate-contracts` is probed directly, both canary and control get 404 because neither the shim forwards it nor Next.js implements that exact path.
   - **Recommendation**: To migrate rate-contracts to Go, either add a path alias in Go (`/rates/contracts`), or map the URL in `api-shim.ts`, while ensuring full parity for contract creation/upsert.

3. **The 4 Finance & Settlement Read Endpoints**:
   - Go implements tenant-scoped read handlers for `/carrier-settlements`, `/driver-payouts`, `/finance-postings`, and `/finance/reconciliation` in `backend/handlers/logistics_finance.go`.
   - In Next.js, these operations were never exposed as individual REST routes; they were internal domain functions triggered during carrier bid awards and settlement generation (`src/app/api/logistics/settlements/route.ts`).
   - Keeping them un-shimmed in Next.js is correct and safe: no existing UI calls `/api/logistics/carrier-settlements`. The existing UI calls `/api/logistics/settlements`, which executes in Next.js (`x-backend: none`, HTTP 200).
   - When the settlement write path is ported to Go in Phase L4d, these read endpoints will provide the query surface for the unified financial ledger.

---

## 6. Live Status & Operational Readiness Update (2026-09-15)

* **Current Status**: **Production-deployed, Go ready, commercial pilot tenant active & verified.**
* **Railway Deployments**:
  - `fleet360-backend` (Production): Deployment `cc2cb80f` (commit `c5210d48`), status `SUCCESS`, reporting `status: "ready"`, DB reachable, Phase 0 phasegate `VERIFIED`.
  - `fleet360-app` (Production): Deployment `7b0ab015` (commit `c5210d48`), status `SUCCESS`, reporting `/api/readyz` healthy.
* **Canary Routing & Commercial Pilot Status**:
  - `LOGISTICS_GO_PROXY_ENABLED`: `true`
  - `LOGISTICS_GO_CANARY_TENANT_IDS`: `b6bb9dff-db22-4e16-a354-2c2b1b8ea98d,bde4707c-011e-4181-8039-47d63356f036,35ad69c6-0451-4210-8ec3-01472c902e15`
  - **Canary Test Tenant 1** (`b6bb9dff...`): `/api/logistics/shipments` returns `HTTP 200` with `x-backend: go`.
  - **Canary Test Tenant 2** (`bde4707c...`): `/api/logistics/shipments` returns `HTTP 200` with `x-backend: go`.
  - **Commercial Pilot Tenant** (`35ad69c6-0451-4210-8ec3-01472c902e15` - XL AI Smart Mobility): `/api/logistics/shipments` returns `HTTP 200` with `x-backend: go` (proxied directly to the Go cluster).
  - **Control Non-Canary Protection**: Unlisted control tenants (e.g. `fc057fdc-aaa2-435d-9375-1926814bcd0c`) return `HTTP 200` with `x-backend: none` (strictly preserved on legacy Next.js route handlers with zero dropped requests).
* **Production Writes & Atomic Sequence Counters**:
  - Commercial Pilot Tenant (`35ad69c6...`): Initialized sequence counters for year `26` and created shipping request `SR-2600001` (`HTTP 201 Created`), proving atomic sequence generation with zero collisions against test canaries.
* **Storage Architecture & Production Verification**:
  - Shared Cloudflare R2 bucket `fleet360-uploads` utilizes logical prefix isolation (`staging/` vs `production/`), formally documented as an explicitly accepted risk in `docs/SECURITY_ACCEPTED_RISKS.md`.
  - Commercial pilot storage lifecycle verified under `production/uploads/35ad69c6-0451-4210-8ec3-01472c902e15/`:
    1. Upload generated key in expected commercial prefix (`HTTP 200`).
    2. Presigned GET URL generated via Go backend endpoint `GET /api/files/sign?key=...` (`HTTP 200`).
    3. Content downloaded from presigned URL verified bit-for-bit against payload (`true`).
    4. Object deleted via `DELETE /api/files?key=...` (`HTTP 204 No Content`).
    5. Post-deletion retrieval attempt returned `HTTP 404`, confirming non-retrievability.
* **Operational Rollback Rehearsal**:
  - Rollback rehearsed and validated in staging: flipping `LOGISTICS_GO_PROXY_ENABLED=false` immediately reverts 100% of canary traffic back to Next.js route handlers with zero dropped requests.




