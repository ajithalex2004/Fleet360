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

Only after every module has been on `spatial.places` for ≥1 release.

### 3a. Drop legacy tables
- `DROP TABLE public.bus_ops_geofences` (and remove the `BusOpsGeofence` Prisma model).
- Remove the backfill INSERT from `prisma/raw/add_spatial_places.sql` (leave a note in the migration header pointing to the follow-up commit).

### 3b. Adopt Places for other cross-module entities
Optional but recommended — reduces duplicated geo-data across the platform:
- **Garage**: `Garage.placeId` FK → `spatial.places.id`. Frees up the standalone lat/lng on `Garage` and lets garages be searchable through the shared catalogue.
- **RouteStop**: `RouteStop.placeId` FK → `spatial.places.id`. The stop is a *reference to a Place at sequence N in a route*, not a separate geospatial entity. Backfill by creating a Place per existing `RouteStop`.
- **Vehicle.homeDepotId**: FK to a `type: DEPOT` Place.

### 3c. Consider a `spatial.place_associations` table
When a Place needs to be linked to many things (e.g. one Depot serves 5 routes), a join table `place_associations(place_id, ref_module, ref_id, role)` is cleaner than adding FKs to every consuming model. Design this in Phase 3, don't build it until at least three consumers need it.

## Watchouts

- **RLS**: `spatial.places` has row-level security via `app.tenant_id` GUC — every reader must go through `withTenantRls()` OR set the header. Direct `prisma.place.findMany()` calls without a tenant filter will see zero rows once RLS is enforced tenant-side (currently the app relays via the `tenantId` where-clause).
- **`sourceModule` / `sourceId`**: These are for reconciliation during coexistence (Phase 1 → 2). Once Phase 3 drops the legacy tables they can be repurposed as generic ownership tags, or dropped entirely.
- **Cast issue on backfill**: `bus_ops_geofences.id` is `uuid` in Postgres but shows as `String` in Prisma. The migration casts `g.id::TEXT` — do the same pattern when writing further backfills against any UUID-native table.
