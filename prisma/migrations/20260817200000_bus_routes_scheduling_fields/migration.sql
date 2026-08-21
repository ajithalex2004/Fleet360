-- Add scheduling metadata columns to bus_routes.
--
-- These are the "typical" scheduling for a route (direction, shift, times)
-- and a default vehicle+driver assignment. Authored on the Routes page's
-- New Route modal. All nullable — pre-existing rows are unaffected.
--
-- IF NOT EXISTS on every column so re-running the migration on a partially
-- migrated environment (e.g. a shared dev DB where someone already added a
-- column by hand) doesn't error out.

ALTER TABLE public.bus_routes
  ADD COLUMN IF NOT EXISTS direction              TEXT,
  ADD COLUMN IF NOT EXISTS shift_type             TEXT,
  ADD COLUMN IF NOT EXISTS departure_time         TEXT,
  ADD COLUMN IF NOT EXISTS expected_arrival_time  TEXT,
  ADD COLUMN IF NOT EXISTS assigned_vehicle_id    TEXT,
  ADD COLUMN IF NOT EXISTS assigned_driver_id     TEXT;
