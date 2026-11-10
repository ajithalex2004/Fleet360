-- Driver columns the Driver Hub reads and writes that no migration created.
--
-- /api/drivers and /api/drivers/[id] store employee_id, driver_category,
-- issuing_authority and additional_documents on public.drivers, and
-- 20261108090000_driver_user_id_unified_identity backfills drivers.user_id
-- by matching drivers.employee_id. A database built from migrations alone has
-- none of these columns, so that migration failed there (42703: column
-- d.employee_id does not exist). Named to run just before it.
--
-- IF NOT EXISTS: a no-op where the columns were added by hand.
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS employee_id TEXT,
  ADD COLUMN IF NOT EXISTS driver_category TEXT,
  ADD COLUMN IF NOT EXISTS issuing_authority TEXT,
  ADD COLUMN IF NOT EXISTS additional_documents JSONB DEFAULT '[]'::jsonb;
