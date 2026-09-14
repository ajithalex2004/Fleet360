-- Closes a structural gap found during the Second-Tenant Onboarding /
-- Enterprise Multi-Tenant Readiness RLS audit: the `fleet`, `workforce`,
-- `operations`, and `spatial` schemas (holding bus_gps_pings, employees,
-- driver_performance, incidents, places) were never created by any
-- tracked migration. Where a tracked ancestor exists under an old
-- name/schema (driver_performance, staff_members -> employees,
-- trip_incidents -> incidents), this migration renames/moves it in
-- place so the tracked history's later ALTERs (tenant_id, RLS) still
-- land correctly. Where no tracked ancestor exists (bus_gps_pings,
-- places), it creates the table directly in its final schema.
--
-- Every step is idempotent and guarded so this is a no-op on an
-- environment that already has these tables in their final shape
-- (i.e. current production), and produces the correct fully-hardened
-- end state on a genuinely fresh environment where none of the earlier
-- untracked runtime-DDL ever ran.

-- ── 1. workforce.driver_performance ──────────────────────────────────────────
-- Base table tracked in 20260413143418_add_transport_modules as
-- public.driver_performance. Only the schema move and the RLS policy
-- (derived via the drivers FK, since this table has no tenant_id column
-- of its own) were ever untracked.
DO $$
BEGIN
  CREATE SCHEMA IF NOT EXISTS workforce;

  IF to_regclass('public.driver_performance') IS NOT NULL
     AND to_regclass('workforce.driver_performance') IS NULL THEN
    ALTER TABLE public.driver_performance SET SCHEMA workforce;
  END IF;

  CREATE TABLE IF NOT EXISTS workforce.driver_performance (
    id               TEXT NOT NULL PRIMARY KEY,
    created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    driver_id        TEXT NOT NULL,
    period_month     INTEGER NOT NULL,
    period_year      INTEGER NOT NULL,
    on_time_pct      DOUBLE PRECISION,
    incident_count   INTEGER,
    customer_rating  DOUBLE PRECISION,
    fuel_efficiency  DOUBLE PRECISION,
    total_trips      INTEGER,
    total_km         DOUBLE PRECISION,
    score            DOUBLE PRECISION
  );

  ALTER TABLE workforce.driver_performance ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS tenant_isolation_via_driver ON workforce.driver_performance;
  CREATE POLICY tenant_isolation_via_driver ON workforce.driver_performance
    USING (
      EXISTS (
        SELECT 1 FROM drivers d
         WHERE d.id = driver_performance.driver_id
           AND (
             d.tenant_id IS NULL
             OR current_setting('app.tenant_id', true) = '*'
             OR d.tenant_id = current_setting('app.tenant_id', true)
           )
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM drivers d
         WHERE d.id = driver_performance.driver_id
           AND (
             d.tenant_id IS NULL
             OR current_setting('app.tenant_id', true) = '*'
             OR d.tenant_id = current_setting('app.tenant_id', true)
           )
      )
    );
END $$;

-- ── 2. workforce.employees (formerly public.staff_members) ──────────────────
-- Base table + tenant_id/FK/RLS all tracked (20260413143418,
-- 20260414000002, 20260625120000) while still named public.staff_members.
-- Only the rename + schema move were untracked. 20260812110000's own
-- hardening (NOT NULL, tenant-scoped unique index, strict RLS) is
-- guarded on workforce.employees already existing, so on a fresh replay
-- it runs BEFORE the rename below and no-ops — this migration reapplies
-- that same hardening idempotently so the end state is correct either way.
DO $$
BEGIN
  IF to_regclass('public.staff_members') IS NOT NULL
     AND to_regclass('workforce.employees') IS NULL THEN
    ALTER TABLE public.staff_members RENAME TO employees;
    ALTER TABLE public.employees SET SCHEMA workforce;
  END IF;

  CREATE TABLE IF NOT EXISTS workforce.employees (
    id                 TEXT NOT NULL PRIMARY KEY,
    created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    employee_id        TEXT,
    name               TEXT NOT NULL,
    department         TEXT,
    contact_number     TEXT,
    email              TEXT,
    default_route_id   TEXT,
    default_stop_id    TEXT,
    is_active          BOOLEAN DEFAULT true,
    updated_at         TIMESTAMPTZ,
    deleted_at         TIMESTAMPTZ,
    designation        TEXT,
    residence_area     TEXT,
    default_stop_name  TEXT,
    shift_type         TEXT,
    transport_type     TEXT DEFAULT 'BUS',
    tenant_id          TEXT
  );

  -- 20260625120000's contribution (tenant_id + FK + index), reapplied idempotently.
  ALTER TABLE workforce.employees ALTER COLUMN tenant_id SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_staff_members_tenant' AND conrelid = 'workforce.employees'::regclass
  ) THEN
    ALTER TABLE workforce.employees
      ADD CONSTRAINT fk_staff_members_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
  END IF;

  CREATE INDEX IF NOT EXISTS idx_staff_members_tenant_id ON workforce.employees (tenant_id);
  CREATE INDEX IF NOT EXISTS idx_employees_tenant_id ON workforce.employees (tenant_id);

  -- 20260812110000's hardening, reapplied idempotently.
  ALTER TABLE workforce.employees DROP CONSTRAINT IF EXISTS "StaffMember_employee_id_key";
  DROP INDEX IF EXISTS workforce.staff_members_employee_id_key;

  CREATE UNIQUE INDEX IF NOT EXISTS uniq_employees_tenant_employee_id
    ON workforce.employees (tenant_id, employee_id)
    WHERE employee_id IS NOT NULL;

  ALTER TABLE workforce.employees ENABLE ROW LEVEL SECURITY;
  ALTER TABLE workforce.employees FORCE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS tenant_isolation ON workforce.employees;
  CREATE POLICY tenant_isolation ON workforce.employees
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
END $$;

-- ── 3. fleet.bus_gps_pings ────────────────────────────────────────────────────
-- No tracked ancestor anywhere — created directly in its final schema/shape.
DO $$
BEGIN
  CREATE SCHEMA IF NOT EXISTS fleet;

  CREATE TABLE IF NOT EXISTS fleet.bus_gps_pings (
    id           TEXT NOT NULL PRIMARY KEY,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tenant_id    TEXT NOT NULL,
    vehicle_id   TEXT NOT NULL,
    schedule_id  TEXT,
    latitude     DOUBLE PRECISION NOT NULL,
    longitude    DOUBLE PRECISION NOT NULL,
    speed_kmh    DOUBLE PRECISION,
    heading_deg  DOUBLE PRECISION,
    accuracy_m   DOUBLE PRECISION,
    occurred_at  TIMESTAMPTZ NOT NULL,
    source       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_bus_gps_pings_vehicle_occurred ON fleet.bus_gps_pings (vehicle_id, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_bus_gps_pings_schedule_occurred ON fleet.bus_gps_pings (schedule_id, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_bus_gps_pings_tenant_id ON fleet.bus_gps_pings (tenant_id);

  ALTER TABLE fleet.bus_gps_pings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE fleet.bus_gps_pings FORCE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS tenant_isolation ON fleet.bus_gps_pings;
  CREATE POLICY tenant_isolation ON fleet.bus_gps_pings FOR ALL
    USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true));
END $$;

-- ── 4. operations.incidents (formerly public.trip_incidents) ────────────────
-- Base structure tracked in 20260414000002_enhance_staff_transport as
-- public.trip_incidents (no tenant_id/module_source yet). The tenant_id
-- column, module_source column, rename, and schema move were all
-- untracked; 20260910000008 only tightened an already-existing policy.
DO $$
BEGIN
  CREATE SCHEMA IF NOT EXISTS operations;

  -- public.incidents already exists as a distinct, unrelated table
  -- (20260811090000_close_mobile_sync_gaps — mobile safety incident
  -- reporting). Moving schema BEFORE renaming avoids colliding with it:
  -- the name collision only matters within the same schema, and
  -- `operations` has nothing named `incidents` yet at this point.
  IF to_regclass('public.trip_incidents') IS NOT NULL
     AND to_regclass('operations.incidents') IS NULL THEN
    ALTER TABLE public.trip_incidents SET SCHEMA operations;
    ALTER TABLE operations.trip_incidents RENAME TO incidents;
  END IF;

  CREATE TABLE IF NOT EXISTS operations.incidents (
    id                 TEXT NOT NULL PRIMARY KEY,
    created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ,
    incident_no        TEXT,
    schedule_id        TEXT,
    route_id           TEXT,
    vehicle_id         TEXT,
    driver_id          TEXT,
    incident_date      TIMESTAMPTZ NOT NULL,
    incident_type      TEXT NOT NULL,
    severity           TEXT DEFAULT 'LOW',
    location           TEXT,
    description        TEXT,
    injuries_reported  BOOLEAN DEFAULT false,
    police_report      BOOLEAN DEFAULT false,
    police_report_no   TEXT,
    action_taken       TEXT,
    status             TEXT DEFAULT 'OPEN',
    resolved_at        TIMESTAMPTZ,
    resolved_by        TEXT
  );

  ALTER TABLE operations.incidents ADD COLUMN IF NOT EXISTS tenant_id UUID;
  ALTER TABLE operations.incidents ADD COLUMN IF NOT EXISTS module_source TEXT NOT NULL DEFAULT 'BUS_OPS';
  ALTER TABLE operations.incidents ALTER COLUMN tenant_id SET NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS trip_incidents_incident_no_key ON operations.incidents (incident_no);
  CREATE INDEX IF NOT EXISTS idx_trip_incidents_tenant_id ON operations.incidents (tenant_id);
  CREATE INDEX IF NOT EXISTS idx_operations_incidents_module_source ON operations.incidents (module_source);
  CREATE INDEX IF NOT EXISTS idx_operations_incidents_tenant ON operations.incidents (tenant_id);
  CREATE INDEX IF NOT EXISTS idx_incidents_tenant_id ON operations.incidents (tenant_id);

  ALTER TABLE operations.incidents ENABLE ROW LEVEL SECURITY;
  ALTER TABLE operations.incidents FORCE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS tenant_isolation ON operations.incidents;
  CREATE POLICY tenant_isolation ON operations.incidents FOR ALL
    USING (current_setting('app.tenant_id', true) = '*' OR (tenant_id)::text = current_setting('app.tenant_id', true))
    WITH CHECK (current_setting('app.tenant_id', true) = '*' OR (tenant_id)::text = current_setting('app.tenant_id', true));
END $$;

-- ── 5. spatial.places ─────────────────────────────────────────────────────────
-- No tracked ancestor anywhere — created directly in its final schema/shape.
DO $$
BEGIN
  CREATE SCHEMA IF NOT EXISTS spatial;

  CREATE TABLE IF NOT EXISTS spatial.places (
    id             TEXT NOT NULL PRIMARY KEY,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ,
    deleted_at     TIMESTAMPTZ,
    tenant_id      TEXT NOT NULL,
    name           TEXT NOT NULL,
    code           TEXT,
    type           TEXT NOT NULL,
    shape          TEXT NOT NULL,
    description    TEXT,
    address        TEXT,
    center_lat     DOUBLE PRECISION,
    center_lng     DOUBLE PRECISION,
    radius_m       INTEGER,
    polygon        JSONB,
    metadata       JSONB,
    source_module  TEXT,
    source_id      TEXT,
    active         BOOLEAN NOT NULL DEFAULT true,
    created_by     TEXT,
    updated_by     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_places_tenant_id ON spatial.places (tenant_id);
  CREATE INDEX IF NOT EXISTS idx_places_tenant_type ON spatial.places (tenant_id, type);
  CREATE INDEX IF NOT EXISTS idx_places_deleted_at ON spatial.places (deleted_at);
  CREATE INDEX IF NOT EXISTS idx_places_source ON spatial.places (source_module, source_id);

  ALTER TABLE spatial.places ENABLE ROW LEVEL SECURITY;
  ALTER TABLE spatial.places FORCE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS places_tenant_isolation ON spatial.places;
  CREATE POLICY places_tenant_isolation ON spatial.places
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
END $$;
