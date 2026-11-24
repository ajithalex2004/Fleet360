-- Schema that application code used to create at request time
-- (src/app/api/admin/company-profile/route.ts and
-- src/lib/logistics/domain.ts). The runtime-DDL guard forbids that: the app
-- role should not hold DDL rights, and tables created that way had no tenant
-- isolation. Every statement is additive and idempotent, so it is safe where
-- the app already created these objects.

-- ── 1. Company profile / e-invoicing (PEPPOL) fields on tenants ──
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS trn TEXT,
  ADD COLUMN IF NOT EXISTS corporate_tax_trn TEXT,
  ADD COLUMN IF NOT EXISTS trade_license_no TEXT,
  ADD COLUMN IF NOT EXISTS trade_license_authority TEXT,
  ADD COLUMN IF NOT EXISTS peppol_endpoint_id TEXT,
  ADD COLUMN IF NOT EXISTS peppol_scheme_id TEXT DEFAULT '0235',
  ADD COLUMN IF NOT EXISTS arabic_name TEXT,
  ADD COLUMN IF NOT EXISTS street_name TEXT,
  ADD COLUMN IF NOT EXISTS additional_street_name TEXT,
  ADD COLUMN IF NOT EXISTS postal_zone TEXT,
  ADD COLUMN IF NOT EXISTS emirate TEXT,
  ADD COLUMN IF NOT EXISTS emirate_code TEXT,
  ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT 'AE',
  ADD COLUMN IF NOT EXISTS tax_scheme_id TEXT DEFAULT 'VAT';

-- ── 2. Carrier app devices, live presence, load broadcasts and offers ──
CREATE TABLE IF NOT EXISTS public.logistics_carrier_app_devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  carrier_id TEXT NOT NULL,
  driver_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  platform TEXT,
  push_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_carrier_app_devices_tenant_carrier
  ON public.logistics_carrier_app_devices (tenant_id, carrier_id);

CREATE TABLE IF NOT EXISTS public.logistics_carrier_presence (
  tenant_id TEXT NOT NULL,
  carrier_id TEXT NOT NULL,
  driver_id TEXT,
  vehicle_id TEXT,
  vehicle_type TEXT,
  availability TEXT NOT NULL DEFAULT 'IDLE',
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  speed_kph DOUBLE PRECISION,
  battery_pct DOUBLE PRECISION,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, carrier_id)
);

CREATE TABLE IF NOT EXISTS public.logistics_load_broadcasts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  rfq_id TEXT,
  status TEXT NOT NULL DEFAULT 'BROADCASTING',
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED',
  pickup_lat DOUBLE PRECISION,
  pickup_lng DOUBLE PRECISION,
  radius_km DOUBLE PRECISION,
  vehicle_type TEXT,
  response_deadline_min INTEGER NOT NULL DEFAULT 10,
  auto_assign BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  assigned_offer_id TEXT,
  assigned_carrier_id TEXT,
  created_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_load_broadcasts_tenant_shipment
  ON public.logistics_load_broadcasts (tenant_id, shipment_order_id);

CREATE TABLE IF NOT EXISTS public.logistics_load_broadcast_offers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  broadcast_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  rfq_id TEXT,
  carrier_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'OFFERED',
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED',
  distance_km DOUBLE PRECISION,
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_load_broadcast_offers_tenant_broadcast
  ON public.logistics_load_broadcast_offers (tenant_id, broadcast_id);

-- ── 3. Tenant isolation (token lookups run under withPlatformAdmin) ──
ALTER TABLE public.logistics_carrier_app_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_carrier_app_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.logistics_carrier_app_devices;
CREATE POLICY tenant_isolation ON public.logistics_carrier_app_devices FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

ALTER TABLE public.logistics_carrier_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_carrier_presence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.logistics_carrier_presence;
CREATE POLICY tenant_isolation ON public.logistics_carrier_presence FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

ALTER TABLE public.logistics_load_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_load_broadcasts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.logistics_load_broadcasts;
CREATE POLICY tenant_isolation ON public.logistics_load_broadcasts FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

ALTER TABLE public.logistics_load_broadcast_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_load_broadcast_offers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.logistics_load_broadcast_offers;
CREATE POLICY tenant_isolation ON public.logistics_load_broadcast_offers FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- ── 4. The app role reads and writes them ──
DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    FOREACH t IN ARRAY ARRAY['logistics_carrier_app_devices', 'logistics_carrier_presence', 'logistics_load_broadcasts', 'logistics_load_broadcast_offers'] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', t);
    END LOOP;
  END IF;
END $$;

-- ── 5. Dispatch columns the dispatch module now requires ──
-- src/lib/dispatch/schema.ts lists these in DISPATCH_SCHEMA (checked by
-- /api/readyz) but only its non-production bootstrap added them, so a
-- migrated database reported "schema incomplete" and production dispatch
-- would refuse to start.
ALTER TABLE IF EXISTS public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS origin_lat DECIMAL(10,8),
  ADD COLUMN IF NOT EXISTS origin_lng DECIMAL(11,8),
  ADD COLUMN IF NOT EXISTS dest_lat DECIMAL(10,8),
  ADD COLUMN IF NOT EXISTS dest_lng DECIMAL(11,8),
  ADD COLUMN IF NOT EXISTS origin_address TEXT,
  ADD COLUMN IF NOT EXISTS destination_address TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_pickup TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS passenger_count INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS driver_id TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_id TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB;

ALTER TABLE IF EXISTS public.vehicle_locations
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

ALTER TABLE IF EXISTS public.driver_availability
  ADD COLUMN IF NOT EXISTS tenant_id TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_id TEXT,
  ADD COLUMN IF NOT EXISTS service_types JSONB DEFAULT '["PASSENGER"]',
  ADD COLUMN IF NOT EXISTS shift_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shift_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE IF EXISTS public.ambulance_capabilities
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- ── 6. E-sign brute-force counter ──
-- src/app/api/esign/verify/route.ts used to add this at request time.
ALTER TABLE IF EXISTS public.esign_requests
  ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0;
