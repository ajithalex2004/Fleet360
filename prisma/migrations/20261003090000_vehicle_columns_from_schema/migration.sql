-- Vehicle columns the Prisma schema declares but no migration created.
--
-- prisma/schema.prisma (model Vehicle, table public.vehicles) declares these
-- columns and both applications read them: Next.js through the Prisma client
-- and raw SQL (vehicle usage, plate, lifecycle, branch, device ...), the Go
-- backend in the logistics stats and analytics (vehicle_usage = 'LOGISTICS').
-- Existing environments got them from the runtime DDL in
-- src/app/api/admin/migrate/fleet-phase1/route.ts or from prisma db push; a
-- database built from the migrations had none of them, so those queries
-- failed there (GET /api/v1/logistics/stats and /analytics: column
-- "vehicle_usage" does not exist).
--
-- Types follow the Prisma schema. ADD COLUMN IF NOT EXISTS leaves every
-- existing column, its type, default and data untouched, so this is a no-op
-- where the columns exist.

ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS color                TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS fuel_type            TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS vehicle_usage        TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS vehicle_group        TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS vehicle_class        TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS seating_capacity     INTEGER;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS odometer_reading     BIGINT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS fuel_level           DOUBLE PRECISION;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS home_depot_id        TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS vehicle_code         TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS vehicle_type_id      TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS lifecycle_stage      TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS acquisition_type     TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS purchase_date        TIMESTAMPTZ(6);
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS purchase_price       DECIMAL(65,30);
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS emirate              TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS plate_number         TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS plate_code           TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS plate_category       TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS registration_no      TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS chassis_no           TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS hierarchy_id         TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS hierarchy_name       TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS branch_name          TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS device_id            TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS sim_card_no          TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS category             TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS notes                TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS mulkiya_expiry       TIMESTAMPTZ(6);
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS assigned_driver_id   TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS garage_id            TEXT;
