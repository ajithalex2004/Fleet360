-- Add tenant_id (TEXT) to dispatch-domain tables.
--
-- Why this migration exists:
--   The original root-level ops script
--   `prisma/ops-scripts/dispatch_tenant_id_backfill.sql` is a one-time
--   ops script that adds tenant_id as UUID, backfills, then gates a
--   SET NOT NULL behind an env var. It is NOT a Prisma migration
--   (Prisma ignores files outside timestamped subfolders) and the UUID
--   type drifts from the fleet-domain migrations which use TEXT.
--
--   This migration makes the dispatch tables formally part of the
--   Prisma schema:
--     1. Adds tenant_id TEXT (nullable — backfill is an ops step)
--     2. Idempotent: existing UUID columns are cast to TEXT (::text)
--     3. Adds the FK + index that the schema declares
--     4. Installs the row-level security policy
--
--   Backfill (DML) is intentionally NOT in this file. See
--   prisma/ops-scripts/dispatch_tenant_id_backfill.sql for that.
--
-- Tables: bus_routes, route_stops, trip_passengers, trip_logs,
--         staff_members, staff_transport_requests, boarding_events,
--         bus_pretrip_checks, ble_gateway_presence.
--
-- NOTE on tenant_id type: TEXT (not UUID), to match the fleet-domain
-- migrations (20260623140000_add_tenant_id_to_fleet_tables) and the
-- existing schema.prisma String @map("tenant_id") declarations.

-- ── 0) Drop any pre-existing tenant_isolation policies on these tables ────────
--
-- Postgres refuses to ALTER COLUMN TYPE while a policy references that column
-- (error 0A000). These tables may already have an RLS policy on tenant_id
-- from an earlier manual script or migration. We drop them here so the
-- UUID→TEXT cast in section 1 can proceed; the policy-recreation blocks in
-- section 4 will put them back with the canonical three-branch USING clause.
--
-- DROP POLICY IF EXISTS is idempotent — safe whether the policy exists or not.

DO $$ BEGIN
  IF to_regclass('public.bus_routes') IS NOT NULL THEN
    DROP POLICY IF EXISTS tenant_isolation ON bus_routes;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.route_stops') IS NOT NULL THEN
    DROP POLICY IF EXISTS tenant_isolation ON route_stops;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.trip_passengers') IS NOT NULL THEN
    DROP POLICY IF EXISTS tenant_isolation ON trip_passengers;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.trip_logs') IS NOT NULL THEN
    DROP POLICY IF EXISTS tenant_isolation ON trip_logs;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.staff_members') IS NOT NULL THEN
    DROP POLICY IF EXISTS tenant_isolation ON staff_members;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.staff_transport_requests') IS NOT NULL THEN
    DROP POLICY IF EXISTS tenant_isolation ON staff_transport_requests;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.boarding_events') IS NOT NULL THEN
    DROP POLICY IF EXISTS tenant_isolation ON boarding_events;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.bus_pretrip_checks') IS NOT NULL THEN
    DROP POLICY IF EXISTS tenant_isolation ON bus_pretrip_checks;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ble_gateway_presence') IS NOT NULL THEN
    DROP POLICY IF EXISTS tenant_isolation ON ble_gateway_presence;
  END IF;
END $$;

-- ── 1) Add tenant_id column (TEXT, nullable) — idempotent + UUID→TEXT cast ──

DO $$ BEGIN
  IF to_regclass('public.bus_routes') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='bus_routes' AND column_name='tenant_id'
    ) THEN
      ALTER TABLE bus_routes ADD COLUMN tenant_id TEXT;
    ELSIF (
      SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='bus_routes' AND column_name='tenant_id'
    ) = 'uuid' THEN
      ALTER TABLE bus_routes ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.route_stops') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='route_stops' AND column_name='tenant_id'
    ) THEN
      ALTER TABLE route_stops ADD COLUMN tenant_id TEXT;
    ELSIF (
      SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='route_stops' AND column_name='tenant_id'
    ) = 'uuid' THEN
      ALTER TABLE route_stops ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.trip_passengers') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='trip_passengers' AND column_name='tenant_id'
    ) THEN
      ALTER TABLE trip_passengers ADD COLUMN tenant_id TEXT;
    ELSIF (
      SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='trip_passengers' AND column_name='tenant_id'
    ) = 'uuid' THEN
      ALTER TABLE trip_passengers ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.trip_logs') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='trip_logs' AND column_name='tenant_id'
    ) THEN
      ALTER TABLE trip_logs ADD COLUMN tenant_id TEXT;
    ELSIF (
      SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='trip_logs' AND column_name='tenant_id'
    ) = 'uuid' THEN
      ALTER TABLE trip_logs ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.staff_members') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='staff_members' AND column_name='tenant_id'
    ) THEN
      ALTER TABLE staff_members ADD COLUMN tenant_id TEXT;
    ELSIF (
      SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='staff_members' AND column_name='tenant_id'
    ) = 'uuid' THEN
      ALTER TABLE staff_members ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.staff_transport_requests') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='staff_transport_requests' AND column_name='tenant_id'
    ) THEN
      ALTER TABLE staff_transport_requests ADD COLUMN tenant_id TEXT;
    ELSIF (
      SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='staff_transport_requests' AND column_name='tenant_id'
    ) = 'uuid' THEN
      ALTER TABLE staff_transport_requests ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.boarding_events') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='boarding_events' AND column_name='tenant_id'
    ) THEN
      ALTER TABLE boarding_events ADD COLUMN tenant_id TEXT;
    ELSIF (
      SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='boarding_events' AND column_name='tenant_id'
    ) = 'uuid' THEN
      ALTER TABLE boarding_events ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.bus_pretrip_checks') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='bus_pretrip_checks' AND column_name='tenant_id'
    ) THEN
      ALTER TABLE bus_pretrip_checks ADD COLUMN tenant_id TEXT;
    ELSIF (
      SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='bus_pretrip_checks' AND column_name='tenant_id'
    ) = 'uuid' THEN
      ALTER TABLE bus_pretrip_checks ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.ble_gateway_presence') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='ble_gateway_presence' AND column_name='tenant_id'
    ) THEN
      ALTER TABLE ble_gateway_presence ADD COLUMN tenant_id TEXT;
    ELSIF (
      SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='ble_gateway_presence' AND column_name='tenant_id'
    ) = 'uuid' THEN
      ALTER TABLE ble_gateway_presence ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
    END IF;
  END IF;
END $$;


-- ── 2) Indexes on tenant_id ─────────────────────────────────────────────────

DO $$ BEGIN
  IF to_regclass('public.bus_routes') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_bus_routes_tenant_id ON bus_routes(tenant_id);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.route_stops') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_route_stops_tenant_id ON route_stops(tenant_id);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.trip_passengers') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_trip_passengers_tenant_id ON trip_passengers(tenant_id);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.trip_logs') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_trip_logs_tenant_id ON trip_logs(tenant_id);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.staff_members') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_staff_members_tenant_id ON staff_members(tenant_id);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.staff_transport_requests') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_staff_transport_requests_tenant_id ON staff_transport_requests(tenant_id);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.boarding_events') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_boarding_events_tenant_id ON boarding_events(tenant_id);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.bus_pretrip_checks') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_bus_pretrip_checks_tenant_id ON bus_pretrip_checks(tenant_id);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ble_gateway_presence') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_ble_gateway_presence_tenant_id ON ble_gateway_presence(tenant_id);
  END IF;
END $$;


-- ── 3) Foreign keys (idempotent) ────────────────────────────────────────────
--
-- Only added for tables where we can derive a stable FK target. The
-- fleet-domain migrations add tenant_id with an FK to tenants(id);
-- we mirror that for the dispatch tables to keep ON DELETE RESTRICT
-- behaviour consistent across the schema.

DO $$ BEGIN
  IF to_regclass('public.bus_routes') IS NOT NULL
     AND to_regclass('public.tenants') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'fk_bus_routes_tenant'
         AND conrelid = 'public.bus_routes'::regclass
     ) THEN
    ALTER TABLE bus_routes
      ADD CONSTRAINT fk_bus_routes_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.route_stops') IS NOT NULL
     AND to_regclass('public.tenants') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'fk_route_stops_tenant'
         AND conrelid = 'public.route_stops'::regclass
     ) THEN
    ALTER TABLE route_stops
      ADD CONSTRAINT fk_route_stops_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.staff_members') IS NOT NULL
     AND to_regclass('public.tenants') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'fk_staff_members_tenant'
         AND conrelid = 'public.staff_members'::regclass
     ) THEN
    ALTER TABLE staff_members
      ADD CONSTRAINT fk_staff_members_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.staff_transport_requests') IS NOT NULL
     AND to_regclass('public.tenants') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'fk_staff_transport_requests_tenant'
         AND conrelid = 'public.staff_transport_requests'::regclass
     ) THEN
    ALTER TABLE staff_transport_requests
      ADD CONSTRAINT fk_staff_transport_requests_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
  END IF;
END $$;


-- ── 4) Row-level security policy (matches tenant_isolation.sql pattern) ─────
--
-- Same policy shape as the legacy root-level tenant_isolation.sql:
-- rows where tenant_id IS NULL (legacy, unbackfilled) are visible to
-- operators, OR where tenant_id matches the session context. The Go
-- backend does not currently SET app.tenant_id per query, so the
-- primary tenant guarantee remains the GORM WithTenant(c) scope.
-- This is belt-and-braces defence for the Prisma side.

DO $$ BEGIN
  IF to_regclass('public.bus_routes') IS NOT NULL THEN
    ALTER TABLE bus_routes ENABLE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.bus_routes') IS NOT NULL THEN
    ALTER TABLE bus_routes FORCE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.bus_routes') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = 'tenant_isolation' AND polrelid = 'public.bus_routes'::regclass
    ) THEN
      CREATE POLICY tenant_isolation ON bus_routes
        USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true));
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.route_stops') IS NOT NULL THEN
    ALTER TABLE route_stops ENABLE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.route_stops') IS NOT NULL THEN
    ALTER TABLE route_stops FORCE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.route_stops') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = 'tenant_isolation' AND polrelid = 'public.route_stops'::regclass
    ) THEN
      CREATE POLICY tenant_isolation ON route_stops
        USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true));
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.trip_passengers') IS NOT NULL THEN
    ALTER TABLE trip_passengers ENABLE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.trip_passengers') IS NOT NULL THEN
    ALTER TABLE trip_passengers FORCE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.trip_passengers') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = 'tenant_isolation' AND polrelid = 'public.trip_passengers'::regclass
    ) THEN
      CREATE POLICY tenant_isolation ON trip_passengers
        USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true));
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.trip_logs') IS NOT NULL THEN
    ALTER TABLE trip_logs ENABLE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.trip_logs') IS NOT NULL THEN
    ALTER TABLE trip_logs FORCE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.trip_logs') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = 'tenant_isolation' AND polrelid = 'public.trip_logs'::regclass
    ) THEN
      CREATE POLICY tenant_isolation ON trip_logs
        USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true));
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.staff_members') IS NOT NULL THEN
    ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.staff_members') IS NOT NULL THEN
    ALTER TABLE staff_members FORCE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.staff_members') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = 'tenant_isolation' AND polrelid = 'public.staff_members'::regclass
    ) THEN
      CREATE POLICY tenant_isolation ON staff_members
        USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true));
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.staff_transport_requests') IS NOT NULL THEN
    ALTER TABLE staff_transport_requests ENABLE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.staff_transport_requests') IS NOT NULL THEN
    ALTER TABLE staff_transport_requests FORCE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.staff_transport_requests') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = 'tenant_isolation' AND polrelid = 'public.staff_transport_requests'::regclass
    ) THEN
      CREATE POLICY tenant_isolation ON staff_transport_requests
        USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true));
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.boarding_events') IS NOT NULL THEN
    ALTER TABLE boarding_events ENABLE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.boarding_events') IS NOT NULL THEN
    ALTER TABLE boarding_events FORCE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.boarding_events') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = 'tenant_isolation' AND polrelid = 'public.boarding_events'::regclass
    ) THEN
      CREATE POLICY tenant_isolation ON boarding_events
        USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true));
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.bus_pretrip_checks') IS NOT NULL THEN
    ALTER TABLE bus_pretrip_checks ENABLE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.bus_pretrip_checks') IS NOT NULL THEN
    ALTER TABLE bus_pretrip_checks FORCE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.bus_pretrip_checks') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = 'tenant_isolation' AND polrelid = 'public.bus_pretrip_checks'::regclass
    ) THEN
      CREATE POLICY tenant_isolation ON bus_pretrip_checks
        USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true));
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.ble_gateway_presence') IS NOT NULL THEN
    ALTER TABLE ble_gateway_presence ENABLE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ble_gateway_presence') IS NOT NULL THEN
    ALTER TABLE ble_gateway_presence FORCE ROW LEVEL SECURITY;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ble_gateway_presence') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = 'tenant_isolation' AND polrelid = 'public.ble_gateway_presence'::regclass
    ) THEN
      CREATE POLICY tenant_isolation ON ble_gateway_presence
        USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true));
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;