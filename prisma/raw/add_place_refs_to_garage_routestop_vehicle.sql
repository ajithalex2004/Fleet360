-- Phase 3b — first-class Place references from Garage / RouteStop / Vehicle.
--
-- Adds three optional FK columns pointing at spatial.places, so any consumer
-- that wants to resolve the geospatial primitive can do so directly rather
-- than reading denormalised lat/lng off the source model.
--
-- This is CAPABILITY-ADDITIVE — no existing reader is changed. Every current
-- query keeps using Garage.location text, RouteStop.gps_lat/gps_lng,
-- Vehicle.* as before. The reader migration is a documented Phase 3.5.
--
-- RouteStop is the only source model with meaningful coordinate data today,
-- so it's the only one we backfill. Garages have a free-text `location`
-- column (not coords); Vehicles have no home-depot data yet.

-- ── Column additions ──────────────────────────────────────────────────
ALTER TABLE public.garages
  ADD COLUMN IF NOT EXISTS place_id TEXT;

ALTER TABLE public.route_stops
  ADD COLUMN IF NOT EXISTS place_id TEXT;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS home_depot_id TEXT;

-- ── Cross-schema foreign keys ─────────────────────────────────────────
-- Postgres supports cross-schema FKs so long as the referenced table is
-- visible in the current search_path (Neon default = public + owner's).
-- ON DELETE SET NULL: a Place can be soft-deleted (deleted_at set) or
-- hard-deleted; either way we don't want to cascade-orphan the source
-- record. The consumer decides how to react to a null placeId.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_garages_place_id') THEN
    ALTER TABLE public.garages
      ADD CONSTRAINT fk_garages_place_id FOREIGN KEY (place_id)
      REFERENCES spatial.places(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_route_stops_place_id') THEN
    ALTER TABLE public.route_stops
      ADD CONSTRAINT fk_route_stops_place_id FOREIGN KEY (place_id)
      REFERENCES spatial.places(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_vehicles_home_depot_id') THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT fk_vehicles_home_depot_id FOREIGN KEY (home_depot_id)
      REFERENCES spatial.places(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_garages_place_id      ON public.garages(place_id);
CREATE INDEX IF NOT EXISTS idx_route_stops_place_id  ON public.route_stops(place_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_home_depot   ON public.vehicles(home_depot_id);

-- ── Backfill RouteStop → Place(type=STOP) ─────────────────────────────
-- One Place per RouteStop that has GPS coords. Uses the stop id as the
-- Place id so re-runs are idempotent and the mapping is stable.
--
-- We treat RouteStop's `geofence_radius_m` (per-stop arrival radius used
-- by the driver-app auto-lifecycle) as the CIRCLE radius when set, else
-- POINT (no radius). This preserves semantics: driver-app auto-arrival
-- keeps working off the Place row too, once Phase 3.5 cuts readers over.
INSERT INTO spatial.places (
  id, created_at, updated_at, tenant_id,
  name, type, shape, center_lat, center_lng, radius_m,
  active, source_module, source_id
)
SELECT
  s.id::TEXT,
  NOW(), NOW(),
  COALESCE(s.tenant_id, ''),
  s.stop_name,
  'STOP',
  CASE WHEN s.geofence_radius_m IS NOT NULL AND s.geofence_radius_m > 0 THEN 'CIRCLE' ELSE 'POINT' END,
  s.gps_lat, s.gps_lng, s.geofence_radius_m,
  TRUE,
  'bus-ops',
  s.id::TEXT
FROM public.route_stops s
WHERE s.gps_lat IS NOT NULL
  AND s.gps_lng IS NOT NULL
  AND s.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM spatial.places p
    WHERE p.id = s.id::TEXT
       OR (p.source_module = 'bus-ops' AND p.source_id = s.id::TEXT)
  );

-- Link stops to their newly-created Places.
UPDATE public.route_stops s
   SET place_id = s.id::TEXT
 WHERE s.place_id IS NULL
   AND EXISTS (SELECT 1 FROM spatial.places p WHERE p.id = s.id::TEXT);
