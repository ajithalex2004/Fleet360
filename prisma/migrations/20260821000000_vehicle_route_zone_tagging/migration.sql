-- Zone tagging for smart vehicle matching (Planning Core's Apply step).
--
-- vehicles.zone_id and bus_routes.zone_id: which OPERATIONAL_ZONE Place a
-- vehicle is based in / a route serves. Both FK-enforced to spatial.places,
-- ON DELETE SET NULL so deleting a zone doesn't take vehicles or routes
-- down with it — mirrors the existing vehicles.home_depot_id pattern.
--
-- bus_routes.assigned_vehicle_id/assigned_driver_id deliberately skip FKs
-- because bus_routes.tenant_id is nullable (cross-tenant-referenced in
-- some legacy contexts) while vehicles.tenant_id/drivers.tenant_id are
-- required — a route in that legacy path could reference a vehicle/driver
-- whose own tenant scoping doesn't line up with the route's. That concern
-- doesn't apply to zone_id: an FK to spatial.places only requires the
-- referenced place to exist, it doesn't check tenant equality, so a
-- nullable-tenant route can still safely reference any zone.
--
-- Both nullable — pre-existing rows are unaffected, and matching on zone
-- stays a soft ranking preference, not a hard requirement (see
-- lib/plan/assign-vehicles.ts): a vehicle or route left untagged simply
-- doesn't get a zone-match bonus, it isn't excluded from consideration.
--
-- IF NOT EXISTS / guarded DO blocks throughout so re-running this on a
-- shared dev DB that already has the column by hand doesn't error out.

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
