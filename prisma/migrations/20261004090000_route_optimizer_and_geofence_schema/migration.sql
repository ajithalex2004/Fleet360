-- Route optimizer and geofence schema, from runtime DDL into a migration.
--
-- The Go backend's route planner and geocoder (backend/handlers/
-- logistics_planner.go, logistics_geocoder.go) and the geofence checks read
-- and write tables and columns that only Next.js created, lazily, the first
-- time one of its code paths ran:
--   src/lib/logistics/route-optimizer-schema.ts  (ensureRouteOptimizerSchema)
--   src/lib/logistics/geofence-schema.ts         (ensureGeofenceSchema)
-- On a database built from the migrations, or before Next.js had run those
-- paths, the Go endpoints failed. This migration creates the same objects,
-- with the same definitions, so the runtime DDL becomes a no-op; it stays in
-- place (idempotent) for environments that apply migrations late.
--
-- Every object is created only where it is missing: where they exist,
-- nothing changes (and no ownership of the existing tables is needed).
--
-- The two new tables carry tenant data and get the project's standard row
-- level security: the platform context ('*') or the row's tenant equal to
-- app.tenant_id, for reads and writes. Both are only read and written inside
-- a tenant context (Go: auth.TenantDB; Next.js: authenticated routes).

-- ── Tables ───────────────────────────────────────────────────────────────

-- One row per optimizer run: DRAFT → COMMITTED → (optional) DISCARDED, with
-- the full inputs and result as JSONB.
CREATE TABLE IF NOT EXISTS logistics_route_plans (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  tenant_id           TEXT NOT NULL,
  created_by          TEXT,
  status              TEXT NOT NULL DEFAULT 'DRAFT',
  algorithm           TEXT NOT NULL,
  config              JSONB,
  input_snapshot      JSONB,
  result              JSONB,
  total_distance_km   NUMERIC(12,2),
  total_duration_min  INTEGER,
  shipments_in        INTEGER,
  shipments_assigned  INTEGER,
  vehicles_used       INTEGER,
  estimated_cost      NUMERIC(15,2),
  committed_at        TIMESTAMPTZ,
  committed_by        TEXT
);

-- Geocode cache, per tenant, one row per normalised address.
CREATE TABLE IF NOT EXISTS logistics_geocode_cache (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id            TEXT NOT NULL,
  normalised_address   TEXT NOT NULL,
  latitude             NUMERIC(10,7) NOT NULL,
  longitude            NUMERIC(10,7) NOT NULL,
  confidence           NUMERIC(3,2),
  source               TEXT NOT NULL DEFAULT 'mapbox',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refreshed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Columns and indexes ──────────────────────────────────────────────────
-- Each is added only when missing. ALTER TABLE ... ADD COLUMN IF NOT EXISTS
-- still requires owning the table, and where the runtime DDL created these
-- objects the migration role may not own them; checking first makes this a
-- true no-op wherever they exist.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    -- Route plans: who committed the plan (added after the table).
    ('logistics_route_plans',    'committed_by',             'TEXT'),
    -- Vehicles: freight capacity (distinct from passenger capacity), depot
    -- and cost per km, for the optimizer.
    ('vehicles',                 'payload_capacity_kg',      'NUMERIC(10,2)'),
    ('vehicles',                 'payload_capacity_cbm',     'NUMERIC(10,3)'),
    ('vehicles',                 'depot_latitude',           'NUMERIC(10,7)'),
    ('vehicles',                 'depot_longitude',          'NUMERIC(10,7)'),
    ('vehicles',                 'cost_per_km',              'NUMERIC(8,2)'),
    -- Drivers: hours-of-service budget and shift window.
    ('drivers',                  'max_drive_hours_per_day',  'NUMERIC(4,2) DEFAULT 10'),
    ('drivers',                  'shift_start_local_time',   'TIME'),
    ('drivers',                  'shift_end_local_time',     'TIME'),
    -- Stops: service time at the stop, geocoding metadata, geofence radius.
    ('logistics_shipment_stops', 'service_duration_minutes', 'INTEGER DEFAULT 15'),
    ('logistics_shipment_stops', 'geocode_confidence',       'NUMERIC(3,2)'),
    ('logistics_shipment_stops', 'geocoded_at',              'TIMESTAMPTZ'),
    ('logistics_shipment_stops', 'geofence_radius_m',        'INTEGER'),
    -- Assignments: the committed route plan and the position in it.
    ('logistics_assignments',    'route_plan_id',            'TEXT'),
    ('logistics_assignments',    'sequence_in_route',        'INTEGER')
  ) AS v(tbl, col, def) LOOP
    -- pg_attribute, not information_schema: the latter hides the columns of
    -- tables the current role has no privilege on.
    IF NOT EXISTS (SELECT 1 FROM pg_attribute
                    WHERE attrelid = to_regclass('public.' || c.tbl)
                      AND attname = c.col AND NOT attisdropped) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I %s', c.tbl, c.col, c.def);
    END IF;
  END LOOP;

  IF to_regclass('public.idx_route_plans_tenant_status') IS NULL THEN
    CREATE INDEX idx_route_plans_tenant_status
      ON logistics_route_plans (tenant_id, status, created_at DESC)
      WHERE deleted_at IS NULL;
  END IF;
  IF to_regclass('public.idx_geocode_cache_tenant_addr') IS NULL THEN
    CREATE UNIQUE INDEX idx_geocode_cache_tenant_addr
      ON logistics_geocode_cache (tenant_id, normalised_address);
  END IF;
END $$;

-- ── Row level security on the new tables ─────────────────────────────────
-- Where the runtime DDL created a table as the runtime role, the migration
-- role may not own it: the change is then reported as a WARNING naming the
-- table, and the owner must run the same statements.
DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['public.logistics_route_plans', 'public.logistics_geocode_cache'] LOOP
    BEGIN
      FOR pol IN SELECT policyname FROM pg_policies
                  WHERE schemaname = split_part(tbl, '.', 1)
                    AND tablename  = split_part(tbl, '.', 2) LOOP
        EXECUTE format('DROP POLICY %I ON %s', pol.policyname, tbl);
      END LOOP;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO fleet360_app', tbl);
      END IF;
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %s FOR ALL '
        'USING (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true)) '
        'WITH CHECK (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true))',
        tbl
      );
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'rls: not the owner of %, row level security NOT enabled on it; run this migration''s RLS block as its owner', tbl;
    END;
  END LOOP;
END $$;
