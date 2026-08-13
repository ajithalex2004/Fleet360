# Follow-up: Route Versioning — Phase 2 (reader migration) + Phase 3 (UI)

Phase 1 (shipped) introduces variants and versions as an additive layer:

- New `BusRouteVariant` + `BusRouteVariantVersion` models with RLS
- `RouteStop.variantVersionId` (optional FK)
- `TripSchedule.routeVariantVersionId` (optional FK, auto-stamped at create)
- `POST /api/bus-ops/routes/[id]/variants` — variant CRUD
- `POST /api/bus-ops/route-variants/[variantId]/versions` — publish new version
- `resolveVariantVersionForTrip()` helper picks the version to snapshot

**Nothing was cut over.** Every existing reader still uses the flat
`route_stops.routeId` link and the free-text `TripSchedule.direction`
column. The versioned path is available for new writes.

## Phase 2 — Reader migration

Each reader should prefer the trip's snapshotted version when it exists,
falling back to the route's current PUBLISHED variant version, falling
back to the flat `route_stops` list. Order:

```
trip.routeVariantVersionId  →  variant's PUBLISHED version  →  route_stops flat
```

**Files to migrate (highest to lowest risk):**

| File | What to change |
|---|---|
| [/api/driver-app/trips/[id]/geofences](../src/app/api/driver-app/trips/[id]/geofences/route.ts) | Origin/destination lookup — join `trip_schedules → bus_route_variant_versions → route_stops` when `route_variant_version_id` is not null; else the current flat join |
| [/api/bus-ops/schedules/[id]/eta](../src/app/api/bus-ops/schedules/[id]/eta/route.ts) | Same — the ETA evaluator reads stops for the trip; must read the *snapshotted* version to stay historically-accurate |
| [/api/bus-ops/routes/[id]/stops](../src/app/api/bus-ops/routes/[id]/stops/route.ts) | Writer — GET returns the flat list today; POST/PUT should auto-create a DRAFT version instead of appending flat stops. Or deprecate this endpoint in favor of `POST .../route-variants/[variantId]/versions` |
| [/api/bus-ops/route-stops](../src/app/api/bus-ops/route-stops/route.ts) | Read-only picker for the New Route form. Widen to accept a `variantVersionId` filter |
| [/api/powerbi/stops](../src/app/api/powerbi/[endpoint]/route.ts) | PowerBI export — decide whether to emit one row per (stop, version) or just the current version |
| Dispatch board + Trip Monitor pages | Show which version each trip ran (small badge) |
| Roster expansion — [src/lib/bus-ops/expand-roster.ts](../src/lib/bus-ops/expand-roster.ts) | When materialising RoutePassenger rows into TripPassenger rows, use the trip's snapshotted stops (their pickup/dropoff stopIds must be resolved against the version, not the flat route) |

## Phase 3 — UI surfaces

- **Route Detail page**: variant tabs (Morning / Evening / Weekend), each with a version dropdown. Publishing shows a diff of stops + confirms the effective-from date.
- **New Trip form**: variant picker (populated from `GET .../routes/[id]/variants`), version picker (defaults to current PUBLISHED).
- **Trip Detail page**: show "Route: 101 · Morning → Office · v3" so ops know which version this trip references.
- **Reports**: filter by variant (compare Morning vs Evening performance) and export historical data as-of the referenced version.

## Phase 4 — Data backfill

For existing routes with flat `route_stops`:

1. Create a `BusRouteVariant` per route, `name='Default'`, `kind=NULL`.
2. Create version 1 (PUBLISHED, `effectiveFrom = route.createdAt`).
3. `UPDATE route_stops SET variant_version_id = <new version id> WHERE route_id = X AND variant_version_id IS NULL`
4. `UPDATE trip_schedules SET route_variant_version_id = <new version id> WHERE route_id = X AND route_variant_version_id IS NULL`

Optional additional split: for routes whose trips have mixed `direction`
values, create two variants (INBOUND / OUTBOUND) and route trips to
the right one based on their `direction` column.

## Design decisions worth revisiting

- **Effective-from on version, not variant** — a variant is an ongoing
  service concept; its versions carry the date bounds. If ops want to
  retire an entire variant permanently they set `isActive=false`. If
  they want the same variant to run only during summer, that's a series
  of versions with tight `effectiveTo`.
- **Kind as free-text** — enum would need a migration per new value.
  Text keeps it flexible; dispatch UI can still show a fixed dropdown.
- **RoutePassenger stays on `routeId`** — a passenger's roster is
  against the route as a whole, and expansion resolves the variant at
  trip create. Alternative: RoutePassenger picks a variant so the
  operator can register different passengers for different directions.
  That'd be a Phase 3 UI addition.
- **Trip.routeId stays populated alongside the snapshot** — this is the
  compatibility surface. Once every reader is on the snapshot, the
  `routeId` column can be dropped (Phase 5).
