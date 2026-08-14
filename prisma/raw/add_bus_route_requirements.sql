-- Phase 2 Resource Validation — add BusRoute requirement columns.
--
-- Nullable so all existing routes remain valid without a backfill.
-- Operators fill them in as they codify their assignment standards;
-- the engine's V5 (vehicle group match) and D7 (license category match)
-- checks only fire when the corresponding column is set.

ALTER TABLE public.bus_routes
  ADD COLUMN IF NOT EXISTS required_vehicle_group TEXT,
  ADD COLUMN IF NOT EXISTS required_license_type  TEXT;

-- No indexes — these columns are only read as part of a route lookup
-- that's already indexed by (id, tenantId). Adding filter indexes now
-- would be premature until a real query pattern demands them.
