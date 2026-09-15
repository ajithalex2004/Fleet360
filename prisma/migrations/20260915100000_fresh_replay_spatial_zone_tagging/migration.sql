-- Closes issue #76: 20260821000000_vehicle_route_zone_tagging adds an FK to
-- spatial.places before that schema exists on a fresh replay.
--
-- 20260821000000 is already applied on every real environment and is left
-- untouched, same approach as every migration in this series. It hard-fails
-- on a genuinely fresh replay because spatial.places isn't created until
-- 20260914010000_close_untracked_domain_schema_gap (#67) — chronologically
-- almost a month later. Because Prisma applies a whole migration file as one
-- transaction, that single FK failure rolls back both column additions in
-- the file too (vehicles.zone_id, bus_routes.zone_id), not just the FK.
--
-- Unlike #73/#75, this isn't a missing-table problem — spatial.places is
-- already correctly built by 20260914010000, which sorts before this
-- migration. This is purely an ordering problem, so the fix is narrower:
-- re-add what 20260821000000 was supposed to add, verbatim, now that
-- spatial.places is guaranteed to exist by the time this runs. No cascading
-- dependents were found (checked in #76's investigation): nothing later in
-- history references vehicles.zone_id or bus_routes.zone_id.
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260821000000_vehicle_route_zone_tagging
-- 20260821000000 cannot be made to succeed as written without editing an
-- already-applied migration, which is unsafe.

-- Belt-and-braces: spatial.places should already exist by this point in
-- migration order (20260914010000 runs first), but this costs nothing to
-- assert and keeps this migration self-sufficient if migration order is
-- ever revisited.
CREATE SCHEMA IF NOT EXISTS spatial;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS zone_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_vehicles_zone_id'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT fk_vehicles_zone_id
      FOREIGN KEY (zone_id) REFERENCES spatial.places(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vehicles_zone_id ON public.vehicles(zone_id);

ALTER TABLE public.bus_routes
  ADD COLUMN IF NOT EXISTS zone_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_bus_routes_zone_id'
  ) THEN
    ALTER TABLE public.bus_routes
      ADD CONSTRAINT fk_bus_routes_zone_id
      FOREIGN KEY (zone_id) REFERENCES spatial.places(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bus_routes_zone_id ON public.bus_routes(zone_id);
