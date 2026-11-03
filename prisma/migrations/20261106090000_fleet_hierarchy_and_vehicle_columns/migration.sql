-- Fleet columns that exist only as runtime DDL in src/lib/fleet/schema.ts.
--
-- 8683ba25 made the fleet schema registry require vehicles.region_id,
-- year_of_manufacture and stop_mode_comm_frequency, but no migration adds
-- them (production skips runtime DDL; its /api/readyz is ready, so the
-- columns exist there). A database built from migrations alone was "not
-- ready". This adds every column of that runtime block, with the same types;
-- IF NOT EXISTS makes it a no-op where they already exist.

ALTER TABLE IF EXISTS public.fleet_transfers
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS requested_by_id TEXT,
  ADD COLUMN IF NOT EXISTS approved_by_id TEXT,
  ADD COLUMN IF NOT EXISTS reason_id TEXT,
  ADD COLUMN IF NOT EXISTS reason_type TEXT;

ALTER TABLE IF EXISTS public.fleet_allocations
  ADD COLUMN IF NOT EXISTS region_id TEXT,
  ADD COLUMN IF NOT EXISTS region_name TEXT,
  ADD COLUMN IF NOT EXISTS department_id TEXT,
  ADD COLUMN IF NOT EXISTS department_name TEXT,
  ADD COLUMN IF NOT EXISTS unit_id TEXT,
  ADD COLUMN IF NOT EXISTS unit_name TEXT;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS region_id TEXT,
  ADD COLUMN IF NOT EXISTS region_name TEXT,
  ADD COLUMN IF NOT EXISTS department_id TEXT,
  ADD COLUMN IF NOT EXISTS department_name TEXT,
  ADD COLUMN IF NOT EXISTS unit_id TEXT,
  ADD COLUMN IF NOT EXISTS unit_name TEXT,
  ADD COLUMN IF NOT EXISTS year_of_manufacture INT,
  ADD COLUMN IF NOT EXISTS stop_mode_comm_frequency INT;
