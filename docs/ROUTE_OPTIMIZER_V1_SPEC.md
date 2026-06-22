# Route Optimizer v1 — Specification

**Status**: draft for decision
**Owner**: logistics product/eng
**Closes gap**: #4 in `LOGISTICS_COMPETITIVE_ANALYSIS.md` (Route Planning & Optimisation, today rated 3/10)

## 1. Goal

Replace the calculator-only `/logistics/planner` page with a real VRP solver that takes a set of shipments + a set of vehicles and returns a sequenced route per vehicle that minimises distance + duration subject to capacity and time-window constraints.

The point of v1 is to ship the **smallest thing that proves the architecture works end-to-end**, not to compete with Convoy on optimisation quality on day one. Phase 1 is a TypeScript heuristic that gets within ~5% of optimal for typical 5–30 stop bookings. Phase 2 (Mapbox Optimization API) is the escape hatch for the hard cases. Phase 3 (OR-Tools sidecar) is deferred until call volume justifies it.

## 2. Scope

### In scope for v1

- **VRPTW**: respect pickup/delivery time windows on each stop.
- **PDVRP**: pickup-before-delivery sequencing per shipment.
- **Capacity constraints**: cumulative weight + volume across the route must stay below vehicle capacity.
- **One depot**: all vehicles start and end at the same tenant depot.
- **Synchronous solve**: operator clicks Optimize, waits ≤5s, sees result.
- **Save + commit**: persist a plan as DRAFT, then explicitly commit it to create `logistics_assignments`.
- **Manual override**: operator can drag a shipment from "unassigned" onto a route, or reorder stops within a route.

### Out of scope for v1 (named so we don't drift)

- Multi-depot routing (each vehicle's start/end depot is the same tenant-level depot for v1).
- Real-time mid-route re-optimisation when a driver runs late.
- Driver mobile-app feedback loop.
- Cost optimisation that prices each route — for v1 we minimise distance; cost is computed for display only.
- Multi-modal (truck + rail + sea) routing.
- Pickup window negotiation with shipper.
- Sharing plans across tenants.

## 3. Algorithm choice for Phase 1

**Clarke-Wright savings algorithm + 2-opt local search**, implemented in TypeScript, runs in-process.

Why this and not something fancier:

- **Savings algorithm** is well-understood, deterministic, and produces routes within 5–10% of optimal for ≤30 stops. ~150 lines of code.
- **2-opt** is a local-search improver that swaps edge pairs; another ~50 lines. Pushes solutions another 1–3% closer to optimal.
- **Zero dependencies**, runs in Node.js inside the existing API route, no Python sidecar, no external API costs.
- **<1s for 50 stops** on a modest server — plenty of headroom for a synchronous endpoint.
- When it stops being good enough (typically at 50+ stops or with tight time windows), Phase 2 kicks in transparently.

What we explicitly aren't doing:

- ❌ Writing our own metaheuristic (genetic algorithm, simulated annealing) — over-engineering for v1.
- ❌ Adopting OR-Tools or jsprit immediately — heavy dependency, would force a sidecar.
- ❌ Going API-first with Mapbox immediately — pay-per-call is the wrong default until we know the access pattern.

## 4. The actual hard problem: distance matrix

This is the dependency to settle BEFORE solver work matters. Without real road-network distances, every solver routes trucks through buildings.

**v1 default: Mapbox Matrix API + Mapbox Geocoding** (real road distances and durations from day one). Mapbox has a generous free tier — 100,000 matrix elements/month and 100,000 geocoding requests/month — that covers Fleet360's early operating volume without spend.

**Cost model** (predict when paid usage starts):

- "Matrix element" = one origin→destination pair. An optimisation with N points (depot + all stops) computes an N × N matrix = N² elements.
- A typical Fleet360 booking has 2 stops (pickup + delivery). An optimisation grouping 5 such bookings = 1 depot + 10 stops = 11 points = **121 elements per optimisation**.
- Free tier (100k elements) = **~825 small optimisations/month** before any charge.
- Above the free tier: $5 per 1,000 elements (tier 2), $4 per 1,000 (tier 3 at 500k+).
- For larger batches (e.g. 30-stop dispatch runs = 961 elements each), free tier ≈ 100 runs/month.
- Mapbox geocoding: $5 per 1,000 forward geocodes above 100k/month free. We cache by normalised address, so the same warehouse only gets geocoded once.

**Always-available fallback: haversine + 1.3× detour factor.** Used for (a) unit tests that shouldn't hit the network, (b) dev mode when no Mapbox key is configured, (c) emergency degraded mode if Mapbox quota is exhausted mid-month. Behind a config flag so production never picks it accidentally.

**Escape hatch for high volume: self-hosted OSRM.** Free at any scale, OpenStreetMap data, ~16GB RAM for the GCC region. Defer until Mapbox spend crosses a hard threshold — call it **$500/month** as the migration trigger. At ~$5/1k elements above free tier, that's ~100k billable elements/month, which is real volume (e.g. 1,000+ optimisations/month of 10-point batches).

Decision still needed before implementation: **Mapbox vs HERE Maps** (both have generous free tiers — Mapbox 100k elements/mo, HERE 250k transactions/mo). My recommendation: **Mapbox**, because their Optimization API (a built-in VRP solver) is the cleanest path for Phase 2 when our heuristic stops being good enough — single contract, single SDK, swap the solver behind the same API key.

## 5. Data model changes

The good news: `logistics_shipment_stops` already has `latitude` / `longitude` columns. They're just empty for everyone today.

### 5.1 ALTERs (idempotent, added to `ensureLogisticsDomainTables()`)

```sql
-- Vehicles: payload capacity (different from seatingCapacity which is for passengers).
-- Today the Vehicle model has capacity:Int defaulting to 30 — that's a vestige of bus
-- seat counts and is unsafe to overload for freight.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS payload_capacity_kg  NUMERIC(10,2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS payload_capacity_cbm NUMERIC(10,3);

-- Where the vehicle starts and ends its shift. Most fleets have one depot per
-- tenant; this is per-vehicle so future multi-depot doesn't need another migration.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS depot_latitude  NUMERIC(10,7);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS depot_longitude NUMERIC(10,7);

-- Drivers: HOS budget and shift envelope. Existing shiftType is a category, not a window.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS max_drive_hours_per_day NUMERIC(4,2) DEFAULT 10;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS shift_start_local_time  TIME;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS shift_end_local_time    TIME;

-- Stops: service duration is the time the driver spends at the stop (loading,
-- paperwork). Critical for VRPTW — without it the solver thinks every stop is
-- instantaneous and produces unworkable schedules.
ALTER TABLE logistics_shipment_stops ADD COLUMN IF NOT EXISTS service_duration_minutes INTEGER DEFAULT 15;
ALTER TABLE logistics_shipment_stops ADD COLUMN IF NOT EXISTS geocode_confidence       NUMERIC(3,2);
ALTER TABLE logistics_shipment_stops ADD COLUMN IF NOT EXISTS geocoded_at              TIMESTAMPTZ;

-- Assignments: trace which optimizer run created the assignment for audit + "undo"
ALTER TABLE logistics_assignments ADD COLUMN IF NOT EXISTS route_plan_id     TEXT;
ALTER TABLE logistics_assignments ADD COLUMN IF NOT EXISTS sequence_in_route INTEGER;
```

### 5.2 New table

```sql
CREATE TABLE IF NOT EXISTS logistics_route_plans (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  tenant_id TEXT NOT NULL,
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT | COMMITTED | DISCARDED
  algorithm TEXT NOT NULL,                -- 'savings' | 'mapbox' | 'or-tools'
  config JSONB,                           -- parameters used (max runtime, objective, etc.)
  input_snapshot JSONB,                   -- shipment + vehicle IDs at run time, frozen for audit
  result JSONB,                           -- the full RouteOptimizerResult (routes, unassigned, summary)
  -- Denormalised summary columns for dashboard queries that don't want to parse JSONB
  total_distance_km   NUMERIC(12,2),
  total_duration_min  INTEGER,
  shipments_in        INTEGER,
  shipments_assigned  INTEGER,
  vehicles_used       INTEGER,
  estimated_cost      NUMERIC(15,2),
  committed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_route_plans_tenant_status
  ON logistics_route_plans (tenant_id, status, created_at DESC);
```

### 5.3 Required pre-work: geocoding

Without lat/lng on every stop, the solver has nothing to work with. Today `logistics_shipment_stops` has the columns but they're NULL for everyone.

**v1 approach**: synchronous geocoding inside the `/optimize` endpoint. For each shipment in the input set, if any stop has NULL lat/lng, call the geocoder, write back, then proceed. Cache geocodes in a `geocode_cache` table keyed by normalised address — same warehouse address only gets geocoded once across all tenants.

**Vendor: Mapbox Geocoding** — same vendor as the Matrix API for §4 (one contract, one key, one SDK). 100,000 forward geocoding requests/month on the free tier. Because addresses are heavily repeated (most shipments pick up from a handful of customer warehouses), the cache hit-rate climbs to 90%+ after the first few weeks, keeping live API calls well inside the free tier indefinitely for most tenants.

**Cache table**:
```sql
CREATE TABLE IF NOT EXISTS logistics_geocode_cache (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  normalised_address TEXT NOT NULL,
  latitude NUMERIC(10,7) NOT NULL,
  longitude NUMERIC(10,7) NOT NULL,
  confidence NUMERIC(3,2),
  source TEXT NOT NULL DEFAULT 'mapbox',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_geocode_cache_tenant_addr
  ON logistics_geocode_cache (tenant_id, normalised_address);
```

Cache invalidation: when a customer or shipment edits its address, the corresponding cache row is deleted (cascade-by-trigger or a simple `DELETE` in the address-update path).

**Fallback**: when `MAPBOX_TOKEN` env var is unset (dev / CI), the geocoder returns the cached row if it exists, otherwise throws a clear error. In production tests, `__mocks__/geocoder.ts` stubs the API.

## 6. API surface

All routes live under `/api/logistics/planner/` and require tenant operator session.

### 6.1 `POST /api/logistics/planner/optimize`

Run the solver. Returns the resulting plan immediately, saved as DRAFT.

**Request body**:

```ts
{
  vehicleIds: string[];      // required, ≥1
  shipmentIds: string[];     // required, ≥1
  config?: {
    algorithm?: 'savings';                       // v1: only 'savings'. v2 adds 'mapbox-optimization'. v3 adds 'or-tools'.
    distanceProvider?: 'mapbox' | 'haversine';   // default 'mapbox' (real road distances).
                                                 //   'haversine' is the offline / quota-exhausted fallback.
    objective?: 'distance' | 'duration' | 'balanced';  // default 'balanced'
    maxRuntimeMs?: number;       // default 5000, max 30000
    detourFactor?: number;       // multiplier when distanceProvider='haversine'; default 1.3, ignored otherwise
  };
}
```

**Response 200**:

```ts
{
  planId: string;
  status: 'COMPLETED' | 'PARTIAL';   // PARTIAL = some shipments unassigned
  algorithm: string;
  summary: {
    totalDistanceKm: number;
    totalDurationMin: number;
    vehiclesUsed: number;
    shipmentsAssigned: number;
    shipmentsUnassigned: number;
    estimatedCost: number;    // sum of vehicle.cost_per_km × distance — for display only
    timeWindowViolations: number;
  };
  routes: Array<{
    vehicleId: string;
    driverId: string | null;
    totalDistanceKm: number;
    totalDurationMin: number;
    capacityUtilization: { weightPct: number; volumePct: number };
    stops: Array<{
      sequence: number;
      stopId: string;
      shipmentId: string;
      type: 'PICKUP' | 'DELIVERY';
      arriveAt: string;       // ISO timestamp
      departAt: string;
      distanceFromPrevKm: number;
      windowFrom: string | null;
      windowTo: string | null;
      onTime: boolean;
      lateMinutes: number;    // 0 when onTime
      loadAfterKg: number;
      loadAfterCbm: number;
    }>;
    violations: Array<{ stopId: string; kind: 'TIME_WINDOW' | 'CAPACITY' | 'HOS'; detail: string }>;
  }>;
  unassigned: Array<{
    shipmentId: string;
    reason: 'NO_CAPACITY' | 'NO_TIME_WINDOW_FIT' | 'NO_VEHICLE_MATCH' | 'GEOCODE_FAILED';
    detail?: string;
  }>;
}
```

**Response 400**: validation errors (no vehicles, no shipments, ungeocoded address with no cache).
**Response 500**: solver crash. The plan is NOT saved on 500; only successful runs persist.

### 6.2 `GET /api/logistics/planner/plans/[id]`

Retrieve a saved plan. Returns the full `RouteOptimizerResult` shape above. Used to render the planner page when an operator returns to it after closing the tab.

### 6.3 `GET /api/logistics/planner/plans`

List recent plans for the dashboard. Query params: `status`, `limit` (default 20, max 100), `period` (days, default 7).

```ts
{
  plans: Array<{
    id: string;
    status: string;
    algorithm: string;
    createdAt: string;
    createdBy: string | null;
    summary: { totalDistanceKm, totalDurationMin, vehiclesUsed, shipmentsAssigned, shipmentsUnassigned };
  }>;
}
```

### 6.4 `POST /api/logistics/planner/plans/[id]/commit`

Promote a DRAFT plan to COMMITTED. Side effects:

1. For each route in the plan, insert/update `logistics_assignments` rows linking the shipment, vehicle, driver, with `route_plan_id` + `sequence_in_route`.
2. Set the underlying shipments' status to `ASSIGNED`.
3. Write status=`COMMITTED`, `committed_at=NOW()` on the plan row.

**Idempotent**: re-committing the same plan is a no-op (returns 200 with the same data).

Body: empty. Response: 200 with the assignment list.

### 6.5 `POST /api/logistics/planner/plans/[id]/discard`

Soft-archive (status → DISCARDED). Used by the operator to throw away a plan they don't like before committing. No side effects on shipments or assignments.

### 6.6 `POST /api/logistics/planner/plans/[id]/edit`

Manual override after optimisation: the operator dragged shipment X off route A onto route B, or reordered stops on route C. Body:

```ts
{
  routes: Array<{
    vehicleId: string;
    stopOrder: string[];  // stopIds in new sequence
  }>;
  unassign?: string[];    // shipmentIds to remove from any route
}
```

The server **re-validates** (capacity, time windows, HOS) but **does not re-optimise** — the operator's intent is preserved. Response is the updated plan with fresh violation flags.

## 7. UI design

The page is `/logistics/planner`. Layout is three-pane + a bottom map + a header strip.

### 7.1 Wireframe

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ⛵ Logistics Planner                                                       │
│                                                                            │
│ Date [2026-06-25 ▼]   Depot [Dubai - Al Quoz ▼]   Vehicles [3 selected ▼] │
│                                                              [ Optimize ▶] │
├──────────────────────┬──────────────────────────────────────┬─────────────┤
│ Unassigned (3)       │ Routes (2 vehicles used)             │ Plan summary│
│                      │                                      │             │
│ ▤ SHP-2600081        │ ┌──────────────────────────────────┐ │ Total dist  │
│   Dubai → Abu Dhabi  │ │ V-101  ·  Driver Ahmed           │ │ 245.7 km    │
│   250kg · 09-12      │ │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━     │ │             │
│                      │ │ 120 km · 3h15 · 75% capacity     │ │ Total time  │
│ ▤ SHP-2600082        │ │ ✓ all stops on time              │ │ 6h 20m      │
│   Sharjah → RAK      │ │                                  │ │             │
│   180kg · 10-14      │ │  1 ◯ Pickup SHP-2600081  08:30   │ │ Vehicles    │
│                      │ │  2 ● Drop   SHP-2600081  10:15   │ │ 2 of 3      │
│ ▤ SHP-2600083        │ │  3 ◯ Pickup SHP-2600082  11:00   │ │             │
│   AD → Dubai         │ │  4 ● Drop   SHP-2600082  13:40   │ │ Assigned    │
│   320kg · 13-16      │ └──────────────────────────────────┘ │ 3 of 3      │
│                      │                                      │             │
│                      │ ┌──────────────────────────────────┐ │ Cost est.   │
│                      │ │ V-102  ·  Driver Layla           │ │ AED 1,200   │
│                      │ │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━     │ │             │
│                      │ │ 125 km · 3h25 · 60% capacity     │ │             │
│                      │ │ ⚠ SHP-2600083 late by 12 min     │ │ [Save Draft]│
│                      │ │                                  │ │ [Commit ▶]  │
│                      │ │  1 ◯ Pickup SHP-2600083  13:15   │ │ [Discard]   │
│                      │ │  2 ● Drop   SHP-2600083  16:12 ⚠ │ │             │
│                      │ └──────────────────────────────────┘ │             │
├──────────────────────┴──────────────────────────────────────┴─────────────┤
│                                                                            │
│       [    MAP — routes coloured per vehicle, stops numbered    ]          │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Interaction flow

1. **Initial load**: page reads the most recent DRAFT plan for the operator (if any), otherwise shows empty state with a "Run optimizer to begin" prompt.
2. **Select inputs**: date + depot + vehicle multi-select. Shipments are auto-filtered to those with delivery dates within ±1 day of the selected date.
3. **Click Optimize**: button shows spinner, ≤5s wait, three-pane fills in. Failure shows a banner with the validation/solver error.
4. **Review**: operator scans for ⚠ violation badges, reads the summary, looks at the map.
5. **Manual adjust** (optional): drag a card from Unassigned onto a route, or drag a stop to reorder within a route. Each drag triggers a re-validate call (`POST .../edit`); violation badges update inline.
6. **Decide**:
   - **Save Draft** → persist as DRAFT, stay on page. Useful for "I'll commit once dispatch supervisor signs off."
   - **Commit ▶** → confirmation modal, then `POST .../commit`. Page transitions to a read-only "Committed" state showing the assignments and a "View Dispatch" link.
   - **Discard** → confirmation, plan archived, page returns to empty state.

### 7.3 States the UI handles

- **Loading**: full-pane skeleton with `Optimizing... avg 3-5s` copy.
- **Empty**: no plan yet — show only the header strip + a centered call-to-action.
- **Geocoding required**: at least one stop has no lat/lng. Inline banner: "3 addresses need geocoding. This may add 10s to the optimization." Auto-geocode on Optimize.
- **Partial success**: solver succeeded but couldn't assign some shipments. Banner: "2 of 5 shipments couldn't be routed — see Unassigned pane for reasons."
- **Violations**: route shows ⚠ badge. Click expands a per-stop violation list. Operator can drag to fix and re-validate.
- **Committed (read-only)**: header changes to green pill "Committed @ 14:23 by Ahmed", buttons replaced with "View Dispatch ▶". Edits disabled.

### 7.4 Component reuse

- `Panel`, `KpiCard`, `StatusPill` from `@/components/ui/page-theme` — same theme system as the dashboard.
- Map: Mapbox GL JS (already a likely dependency if we pick Mapbox for matrix/geocode), or Leaflet + OpenStreetMap tiles for a vendor-free start.
- Drag-and-drop: `@dnd-kit` (commonly used in the project — check `package.json` first; otherwise raw HTML5 drag events are fine for v1).

## 8. Estimated effort by phase

| Phase | Scope | Effort | When to commit |
|---|---|---|---|
| **Phase 0 (prereq)** | Mapbox Matrix + Geocoding integration. Geocode cache table. Haversine helper for offline/dev fallback. | 4-5 days | Always — before Phase 1 starts. |
| **Phase 1** | Heuristic solver (Clarke-Wright + 2-opt) + API endpoints (1–6) + UI page. ~70% routes within 5% of optimal. | 10-12 days | Now, if §11 decisions resolve. |
| **Phase 2** | Mapbox Optimization API adapter (their built-in VRP solver). Same Matrix calls underneath. Switchable via `config.algorithm`. | 5-7 days | When the heuristic stops being good enough (50+ stops, tight time windows, specialised constraints). |
| **Phase 3** | Self-hosted OSRM for distance/geocoding when Mapbox spend crosses ~$500/mo. OR-Tools Python sidecar for the solver when specialised constraints emerge. | 4-6 weeks | When monthly Mapbox bill makes self-hosting cheaper, or when constraints exceed what Mapbox Optimization handles. |

**Total Phase 1 effort: ~3 weeks** including the prereq.

## 9. Tests

Following the same pattern as the rate-engine and accessorial work:

- **Unit (~30 tests)**: savings-algorithm primitives (savings calculation, route merge feasibility), 2-opt improver, capacity check, time-window check, geocode cache hit/miss, distance-matrix helper.
- **Integration (~8 tests)**: full pipeline against a real Postgres — seed vehicles + shipments + stops, run optimize, verify plan rows + route shape + commit creates assignments.
- **Smoke**: `scripts/smoke-route-optimizer.js` — seeds a 5-stop scenario, runs optimize via API, commits, verifies assignments. <30s end-to-end.

## 10. Risks & non-obvious gotchas

- **Time-zone arithmetic**: time windows are stored as `TIMESTAMPTZ` (UTC) but operators think in local time. The solver compares in UTC; the UI displays local. Off-by-an-hour bugs around DST are likely if we're not careful.
- **Cumulative load tracking**: the heuristic must track load along the route, not just at end. A shipment that picks up 800kg and delivers later means the truck is carrying that 800kg for the middle of the route — that's where capacity violations actually happen.
- **Service-time aggregation**: skipping `service_duration_minutes` is the most common rookie error in VRPTW implementations. With 10 stops and 15 min each, that's 2.5h of standing time the solver ignores and produces an impossible schedule.
- **Pickup-before-delivery enforcement**: needs to be a HARD constraint in the heuristic, not a post-validation. A route that visits Drop before Pickup is not "lower quality" — it's invalid.
- **Geocode cache invalidation**: if an operator edits a shipment's address, the cached lat/lng goes stale. Need to invalidate cache when address changes.
- **Multi-tenant correctness**: every query must scope by `tenant_id`. The optimizer reads vehicles, drivers, shipments, stops, cache — five tables, five places to forget.

## 11. Resolved decisions

All six v1 decisions are locked in. Phase 1 is fully scoped and ready to break into a 10-12 day execution plan.

| # | Decision | Resolution | Implication |
|---|---|---|---|
| 1 | SaaS vendor for distances + geocoding | **Mapbox** | Matrix + Geocoding from day one. Single key, single SDK. Phase 2 swaps to Mapbox Optimization API under the same contract. |
| 2 | Target stop count v1 must handle well | **<30 stops** | Clarke-Wright + 2-opt sits comfortably in this range (within ~5% of optimal, <1s runtime). Free tier covers ~100 optimisations/month at this size. |
| 3 | Mid-route re-optimisation in v1 | **No** | v1 is "plan-at-dispatch only." Mid-route changes go through manual reassign on the dispatch page. Mid-route re-opt deferred to v1.5 as its own ship. |
| 4 | Capacity dimensions | **Weight + Volume** | Both `payload_capacity_kg` and `payload_capacity_cbm` enforced as hard constraints in the heuristic. LCL / low-density cargo handled correctly from day one. |
| 5 | Cost model | **Per-km only** | New `vehicles.cost_per_km` column. Route cost = `total_km × cost_per_km`. Display-only; the optimiser still minimises distance, not cost. |
| 6 | Vehicle "available today" data source | **`logistics_carrier_vehicles.availability_status`** | Vehicle picker filters by this column. No new blackouts table — maintenance windows live in the existing maintenance module and feed into `availability_status` already. |

### What's now explicitly out of scope for v1 (cross-reference §2)

- Mid-route re-optimisation (deferred to v1.5)
- Multi-depot routing
- Driver mobile-app feedback loop
- Cost-objective optimisation (we minimise distance, display cost)

Phase 0 (~4-5 days) can start immediately: provision the Mapbox account + token, build the geocoder wrapper + cache table, build the distance-matrix helper with Mapbox-primary / haversine-fallback, and land the ALTERs from §5.1.
