-- ble_gateways serves two modules: Bus Ops (one gateway per vehicle, found by
-- device id) and Assets (depot, warehouse and vehicle gateways with a code,
-- name and location). Production already holds both column sets with the
-- bus-only fields optional; fresh installs still had the strict bus-only
-- table, so the Assets screens failed there. This brings every database to
-- the production shape. Safe to re-run.
ALTER TABLE IF EXISTS public.ble_gateways ALTER COLUMN vehicle_id DROP NOT NULL;
ALTER TABLE IF EXISTS public.ble_gateways ALTER COLUMN gateway_id DROP NOT NULL;
ALTER TABLE IF EXISTS public.ble_gateways ALTER COLUMN vehicle_id TYPE TEXT USING vehicle_id::text;
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS secret TEXT;
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS secret_rotated_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS gateway_code TEXT;
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS location_type TEXT NOT NULL DEFAULT 'DEPOT';
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS location_name TEXT;
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS location_zone TEXT;
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS lat NUMERIC(10,7);
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS lng NUMERIC(10,7);
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS firmware_version TEXT;
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS tags_visible INT DEFAULT 0;
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ONLINE';
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS alert_on_offline BOOLEAN DEFAULT TRUE;
ALTER TABLE IF EXISTS public.ble_gateways ADD COLUMN IF NOT EXISTS offline_threshold_min INT DEFAULT 15;
CREATE INDEX IF NOT EXISTS idx_ble_gateways_status ON public.ble_gateways (status);
