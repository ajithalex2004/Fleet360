-- Port & Container Drayage tables (src/lib/logistics/drayage-domain.ts).
--
-- These were created at runtime by ensureDrayageSchema(), which the
-- runtime-DDL guard (scripts/check-no-runtime-ddl.mjs) blocks: schema
-- belongs in migrations. At runtime it also could not work where it mattered:
-- the production app role (fleet360_app) has no DDL rights, so ensureDrayageSchema
-- swallowed "permission denied" (42501) and the tables were never created
-- there. This migration creates them as the migration owner, with the same
-- columns, plus what every tenant table here has: a tenant_id index, FORCE
-- row-level security with the tenant_isolation policy, and app-role grants.
--
-- Idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS): safe where the runtime
-- code did manage to create some of the tables.

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS logistics_drayage_terminals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  port_name TEXT NOT NULL,
  emirate TEXT NOT NULL DEFAULT 'Dubai',
  lat DOUBLE PRECISION NOT NULL DEFAULT 25.0112,
  lng DOUBLE PRECISION NOT NULL DEFAULT 55.0612,
  geofence_radius_meters INTEGER NOT NULL DEFAULT 1500,
  free_days_dry INTEGER NOT NULL DEFAULT 5,
  free_days_reefer INTEGER NOT NULL DEFAULT 3,
  operating_hours TEXT NOT NULL DEFAULT '24/7 Gate Operations',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logistics_drayage_clients (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  contact_person TEXT,
  contact_no TEXT,
  street_address TEXT,
  city TEXT DEFAULT 'Dubai',
  trn TEXT,
  trade_license TEXT,
  default_trip_amount_aed DOUBLE PRECISION NOT NULL DEFAULT 1550,
  default_driver_allowance_aed DOUBLE PRECISION NOT NULL DEFAULT 150,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logistics_drayage_warehouses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  name TEXT NOT NULL,
  zone TEXT NOT NULL,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL DEFAULT 24.9642,
  lng DOUBLE PRECISION NOT NULL DEFAULT 55.0915,
  ramps_count INTEGER NOT NULL DEFAULT 6,
  contact_person TEXT,
  contact_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE logistics_drayage_warehouses
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS geofence_configured BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS geofence_type TEXT DEFAULT 'CIRCLE',
  ADD COLUMN IF NOT EXISTS geofence_radius_meters INTEGER DEFAULT 800,
  ADD COLUMN IF NOT EXISTS geofence_coordinates_json TEXT DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS trip_amount_aed DOUBLE PRECISION DEFAULT 1550,
  ADD COLUMN IF NOT EXISTS driver_allowance_aed DOUBLE PRECISION DEFAULT 150;

CREATE TABLE IF NOT EXISTS logistics_drayage_trailers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  plate_number TEXT NOT NULL,
  trailer_type TEXT NOT NULL DEFAULT '40FT_SKELETAL',
  capacity_tons DOUBLE PRECISION NOT NULL DEFAULT 45,
  master_status TEXT NOT NULL DEFAULT 'AVAILABLE',
  operational_status TEXT NOT NULL DEFAULT 'EMPTY',
  linked_container_number TEXT,
  current_location TEXT DEFAULT 'Jebel Ali Main Yard',
  lat DOUBLE PRECISION DEFAULT 25.0045,
  lng DOUBLE PRECISION DEFAULT 55.0680,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logistics_drayage_containers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  container_number TEXT NOT NULL,
  size TEXT NOT NULL DEFAULT '40HC',
  container_type TEXT NOT NULL DEFAULT 'DRY',
  shipment_type TEXT NOT NULL DEFAULT 'IMPORT',
  status TEXT NOT NULL DEFAULT 'AT_PORT_DISCHARGED',
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  terminal_id TEXT,
  terminal_name TEXT NOT NULL,
  warehouse_id TEXT,
  warehouse_name TEXT NOT NULL,
  do_expiry_date TIMESTAMPTZ,
  discharge_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  empty_return_date TIMESTAMPTZ,
  seal_number TEXT,
  weight_kg DOUBLE PRECISION NOT NULL DEFAULT 22400,
  customs_inspection BOOLEAN NOT NULL DEFAULT FALSE,
  municipality_inspection BOOLEAN NOT NULL DEFAULT FALSE,
  cpip_inspection BOOLEAN NOT NULL DEFAULT FALSE,
  merc_inspection BOOLEAN NOT NULL DEFAULT FALSE,
  boxcare_inspection BOOLEAN NOT NULL DEFAULT FALSE,
  linked_trailer_plate TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logistics_drayage_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  job_code TEXT NOT NULL,
  job_phase TEXT NOT NULL DEFAULT 'L1',
  parent_job_id TEXT,
  shipment_type TEXT NOT NULL DEFAULT 'IMPORT',
  status TEXT NOT NULL DEFAULT 'PENDING',
  priority TEXT NOT NULL DEFAULT 'STANDARD',
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  warehouse_id TEXT,
  warehouse_name TEXT NOT NULL,
  terminal_id TEXT,
  terminal_name TEXT NOT NULL,
  container_id TEXT,
  container_number TEXT NOT NULL,
  container_size TEXT NOT NULL DEFAULT '40HC',
  container_type TEXT NOT NULL DEFAULT 'DRY',
  do_expiry_date TIMESTAMPTZ,
  token_number TEXT,
  assigned_vehicle_id TEXT,
  assigned_vehicle_plate TEXT,
  assigned_driver_id TEXT,
  assigned_driver_name TEXT,
  assigned_trailer_id TEXT,
  assigned_trailer_plate TEXT,
  placement_location TEXT,
  trailer_detached BOOLEAN NOT NULL DEFAULT FALSE,
  l2_activated BOOLEAN NOT NULL DEFAULT FALSE,
  rate_amount_aed DOUBLE PRECISION NOT NULL DEFAULT 1450,
  driver_allowance_aed DOUBLE PRECISION NOT NULL DEFAULT 150,
  customs_inspection BOOLEAN NOT NULL DEFAULT FALSE,
  municipality_inspection BOOLEAN NOT NULL DEFAULT FALSE,
  cpip_inspection BOOLEAN NOT NULL DEFAULT FALSE,
  merc_inspection BOOLEAN NOT NULL DEFAULT FALSE,
  boxcare_inspection BOOLEAN NOT NULL DEFAULT FALSE,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  notes TEXT,
  etc_time TIMESTAMPTZ,
  etc_alert_status TEXT NOT NULL DEFAULT 'NEW',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Offload ETC (estimated completion of destuffing) drives the L2 empty-return
-- auto-activation; ADD COLUMN covers databases where the table already exists.
ALTER TABLE logistics_drayage_jobs
  ADD COLUMN IF NOT EXISTS etc_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS etc_alert_status TEXT NOT NULL DEFAULT 'NEW';

CREATE TABLE IF NOT EXISTS logistics_drayage_allowances (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  job_code TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  vehicle_plate TEXT,
  container_number TEXT NOT NULL,
  trip_phase TEXT NOT NULL DEFAULT 'L1',
  route_summary TEXT NOT NULL,
  allowance_amount_aed DOUBLE PRECISION NOT NULL DEFAULT 150,
  port_gate_fee_aed DOUBLE PRECISION NOT NULL DEFAULT 35,
  overnight_halt_aed DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_amount_aed DOUBLE PRECISION NOT NULL DEFAULT 185,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logistics_drayage_geofences (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  terminal_id TEXT,
  terminal_name TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'CIRCLE',
  center_lat DOUBLE PRECISION NOT NULL DEFAULT 25.0112,
  center_lng DOUBLE PRECISION NOT NULL DEFAULT 55.0612,
  radius_meters INTEGER NOT NULL DEFAULT 1500,
  coordinates_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logistics_drayage_status_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  job_code TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'Dispatch Console',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logistics_drayage_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  job_code TEXT NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'DISPATCHER',
  sender_name TEXT NOT NULL,
  message TEXT NOT NULL,
  is_urgent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logistics_drayage_alerts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  alert_key TEXT NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Legacy terminal codes ───────────────────────────────────────────────────
-- ensureDrayageSchema() renamed these on every start; once is enough. Runs
-- before RLS is enabled below, so it sees every tenant's rows.
UPDATE logistics_drayage_terminals
   SET code = CASE code
     WHEN 'AEJEA-T1' THEN 'DPW-JA-T1'
     WHEN 'AEJEA-T2' THEN 'DPW-JA-T2'
     WHEN 'AEJEA-T3' THEN 'DPW-JA-T3'
     WHEN 'AEKHL-T1' THEN 'ADP-KP-T1'
     WHEN 'AEDXB-PR' THEN 'DPW-PR-T1'
     ELSE code
   END
 WHERE code IN ('AEJEA-T1', 'AEJEA-T2', 'AEJEA-T3', 'AEKHL-T1', 'AEDXB-PR');

-- ── Tenant isolation, indexes, grants ───────────────────────────────────────
-- Same policy shape as 20261017090000_runtime_module_tables_and_isolation.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'logistics_drayage_terminals', 'logistics_drayage_clients', 'logistics_drayage_warehouses',
    'logistics_drayage_trailers', 'logistics_drayage_containers', 'logistics_drayage_jobs',
    'logistics_drayage_allowances', 'logistics_drayage_geofences', 'logistics_drayage_status_logs',
    'logistics_drayage_messages', 'logistics_drayage_alerts'
  ] LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)', 'idx_' || t || '_tenant_id', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL '
      'USING ((current_setting(''app.tenant_id'', true) = ''*'') OR ((tenant_id)::text = current_setting(''app.tenant_id'', true))) '
      'WITH CHECK ((current_setting(''app.tenant_id'', true) = ''*'') OR ((tenant_id)::text = current_setting(''app.tenant_id'', true)))',
      t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', t);
    END IF;
  END LOOP;
END $$;
