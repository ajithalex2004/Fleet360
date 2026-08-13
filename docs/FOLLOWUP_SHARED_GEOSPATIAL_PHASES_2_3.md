# Follow-up: Shared Geospatial — Phases 2 & 3

Phase 1 (delivered) shipped the `spatial.places` table + `Place` Prisma model + `/api/places` CRUD + `/locations` page + backfill from `bus_ops_geofences`. **The old table stays fully functional — nothing in the app was cut over yet.** These are the follow-up phases.

## Phase 2 — Consumer cutover (per module)

### 2a. bus-ops geofences ✅ SHIPPED (commit c137ac17)

The API routes `/api/bus-ops/geofences` and `/[id]` now read/write against `spatial.places` filtered by `sourceModule='bus-ops'`. Response contract is unchanged (projection maps `Place.description` → `notes`) so the bus-ops geofences page and any external cached references keep working with no rewrite. The `[id]` handler also accepts legacy `bus_ops_geofences.id` via `source_id` lookup as a fallback.

Data still resides in `public.bus_ops_geofences` (nothing dropped) but no *new* writes land there — every new geofence goes to `spatial.places`.

### 2b. logistics geofences — no action needed today

Logistics derives geofences in-memory from `logistics_shipment_stops` (per-stop `latitude`/`longitude`/`geofence_radius_m` columns) plus an optional `metadata.routePolyline` corridor. **There is no persistent geofence table to migrate.**

Add a Place-based override capability only when an operator actually asks for it. When that happens the change is:
- Read `spatial.places` rows tagged `sourceModule='logistics'` with `metadata.shipmentStopId = <id>` before deriving the on-the-fly circle in [src/lib/logistics/geofence-service.ts](../src/lib/logistics/geofence-service.ts).
- Fall back to the current per-stop radius when no override exists.
- No API surface needed — read directly via `prisma.place.findMany()`.

### 2c. school-bus + ambulance dispatch — no consumers

Verified via `grep '/api/bus-ops/geofences|busOpsGeofence' src/` — the only consumer of the bus-ops geofence endpoint is the bus-ops geofences page itself. School-bus and ambulance never shared it. Nothing to cut over.

### 2d. Map drawing on `/locations` — deferred UX polish

Currently `/locations` is form-only for geometry entry. The bus-ops geofences page still provides full map-based drawing, and it writes to the same shared table now, so no user is blocked. Fold in later by:
- Extracting [src/components/bus-ops/GeofenceMap.tsx](../src/components/bus-ops/GeofenceMap.tsx) → `src/components/shared/PlaceMap.tsx` (rename + widen typing to `Place[]`).
- Update the bus-ops geofences page to import from the new path (small).
- Add the map to `/locations` next to the table view.

### 2e. Sidebar per-type shortcuts — deferred

Adding `/locations?type=STOP`, `?type=DEPOT`, etc. requires the sub-page matcher in [src/components/nav/Sidebar.tsx](../src/components/nav/Sidebar.tsx) to compare pathname *plus* querystring (currently just pathname). Small change, but low value until users need it — the in-page type filter covers the case for now.

## Phase 3 — Legacy sunset + first-class references

### 3a. Drop legacy tables ✅ SHIPPED

- `public.bus_ops_geofences` dropped ([prisma/raw/drop_bus_ops_geofences.sql](../prisma/raw/drop_bus_ops_geofences.sql)) with an orphan-preflight that refuses to run if any row is missing from `spatial.places`.
- `BusOpsGeofence` Prisma model removed from [prisma/schema.prisma](../prisma/schema.prisma) with a sunset marker pointing here.
- Backfill INSERT in `add_spatial_places.sql` stays for now — it's idempotent (`NOT EXISTS` guard) and safe to re-run against environments that never received the Phase 2a cutover. Remove in a follow-up commit once every environment has been past Phase 3a for a release.

### 3b. Adopt Places for other cross-module entities ✅ SHIPPED

Three optional cross-schema FKs added, all backfill-safe and additive:
- **Garage.placeId** → `spatial.places(id)`. No auto-backfill (Garage has no coord columns to migrate — `location` is text). Available for manual linking via UI.
- **RouteStop.placeId** → `spatial.places(id)`. Auto-backfilled: for every RouteStop with `gps_lat`+`gps_lng`+`tenant_id`, a Place(type=STOP, shape=CIRCLE or POINT depending on `geofence_radius_m`) is created with the stop's id preserved as the Place id. Idempotent, filters out null-tenant rows (dev seed data).
- **Vehicle.homeDepotId** → `spatial.places(id)`. New capability, no data to backfill.

All three FKs use `ON DELETE SET NULL` so a Place soft/hard-delete doesn't cascade-orphan the source. Migration file: [prisma/raw/add_place_refs_to_garage_routestop_vehicle.sql](../prisma/raw/add_place_refs_to_garage_routestop_vehicle.sql).

**No reader was cut over** — this ships the *capability*. Existing consumers still use `garage.location`, `route_stops.gps_lat/gps_lng`, `route_stops.geofence_radius_m` as before. The Prisma model comments call out that Phase 3.5 migrates readers.

### 3.5. Reader migration (NEW — not started)

The FK columns land data in `spatial.places`, but every current reader still reads the denormalized columns on the source model. Migrating readers is the follow-up:
- **RouteStop reads**: [/api/driver-app/trips/[id]/geofences](../src/app/api/driver-app/trips/[id]/geofences/route.ts) reads `route_stops.gps_lat/gps_lng/geofence_radius_m` directly. Switch to reading the linked Place. Same for [/api/bus-ops/schedules/[id]/eta](../src/app/api/bus-ops/schedules/[id]/eta/route.ts) and every ETA/dispatch consumer.
- **Dual-write on RouteStop create/update**: the write path (routes UI, planner) must also create/update the Place row. Extract a `syncStopPlace(stop)` helper.
- **Garage reads**: garage list/detail pages read `location` (text). If we start capturing coords, they'll come from Place — add an "on the map" section on the garage page.
- **Vehicle homeDepot reads**: fleet/vehicles page can add a "home depot" column that joins Place.

Watch out for the RLS boundary — cross-schema reads under `withTenantRls()` need `spatial.places` policies to accept the same GUC (they already do — see `add_spatial_places.sql`).

### 3c. Consider a `spatial.place_associations` table
When a Place needs to be linked to many things (e.g. one Depot serves 5 routes), a join table `place_associations(place_id, ref_module, ref_id, role)` is cleaner than adding FKs to every consuming model. Design this in Phase 3, don't build it until at least three consumers need it.

## Watchouts

- **RLS**: `spatial.places` has row-level security via `app.tenant_id` GUC — every reader must go through `withTenantRls()` OR set the header. Direct `prisma.place.findMany()` calls without a tenant filter will see zero rows once RLS is enforced tenant-side (currently the app relays via the `tenantId` where-clause).
- **`sourceModule` / `sourceId`**: These are for reconciliation during coexistence (Phase 1 → 2). Once Phase 3 drops the legacy tables they can be repurposed as generic ownership tags, or dropped entirely.
- **Cast issue on backfill**: `bus_ops_geofences.id` is `uuid` in Postgres but shows as `String` in Prisma. The migration casts `g.id::TEXT` — do the same pattern when writing further backfills against any UUID-native table.
