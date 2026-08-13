# Follow-up: Shared Geospatial — Phases 2 & 3

Phase 1 (delivered) shipped the `spatial.places` table + `Place` Prisma model + `/api/places` CRUD + `/locations` page + backfill from `bus_ops_geofences`. **The old table stays fully functional — nothing in the app was cut over yet.** These are the follow-up phases.

## Phase 2 — Consumer cutover (per module)

Each module points at `/api/places` instead of its own geofence store. **Do these one module at a time**, verify, then move on — don't do them as a single big-bang.

### 2a. bus-ops geofences
- Replace fetches to `/api/bus-ops/geofences` with `/api/places?type=STOP,GEOFENCE,GARAGE,ORIGIN_DESTINATION,BASE_CAMP,ACCOMMODATION&sourceModule=bus-ops`.
- Update [src/app/(app)/bus-ops/geofences/page.tsx](../src/app/(app)/bus-ops/geofences/page.tsx) writes to POST/PATCH `/api/places` with `sourceModule: 'bus-ops'` stamped.
- Update [src/components/bus-ops/GeofenceMap.tsx](../src/components/bus-ops/GeofenceMap.tsx) — component signature can stay the same; wire it to the shared endpoint.
- Once the page is exclusively on `/api/places`, deprecate `/api/bus-ops/geofences/*` (leave stubs returning 410 Gone for a release, then remove).
- **Do not drop `public.bus_ops_geofences` yet** — Phase 3 handles the DDL sunset after every consumer is on Places for at least one release.

### 2b. logistics geofences
Logistics has no persistent geofence store today — it derives them per-shipment. Migration is smaller:
- New `spatial.places` rows of `type: GEOFENCE, sourceModule: 'logistics'` for any per-stop overrides that should persist across shipments.
- [src/lib/logistics/geofence-service.ts](../src/lib/logistics/geofence-service.ts) reads from Places first, falls back to the current per-stop radius column.
- No API deprecation needed.

### 2c. school-bus + ambulance dispatch
Both currently reuse bus-ops' geofence endpoints ad-hoc. Repoint to `/api/places?sourceModule=school-bus` and `...&sourceModule=ambulance`. Same shape as 2a.

### 2d. Map drawing in the shared page
Reuse [`GeofenceMap.tsx`](../src/components/bus-ops/GeofenceMap.tsx) inside `/locations`:
- Extract to `src/components/shared/PlaceMap.tsx` (rename + tighten signature — should take generic `Place[]` not `GeofenceRecord[]`).
- Update the Locations page to drop the "Polygon geometry can't be drawn from this form yet" placeholder and use the map for draw + edit like bus-ops geofences does today.

### 2e. Sidebar per-type shortcuts
Once the sidebar sub-page matcher supports querystring matching (currently `pathname === sp.href` — misses query), add per-type shortcuts back to `/locations` in `src/lib/nav/modules.ts`:
- `/locations?type=STOP`, `/locations?type=GEOFENCE`, `/locations?type=DEPOT`, etc.

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
