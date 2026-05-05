-- ============================================================
-- Tenant Isolation Migration — XL AI Smart Mobility
-- All statements are idempotent (safe to run multiple times).
-- NOTE: tenant_id columns were already added in a prior run.
--       This script handles backfill, indexes, RLS, and helper fn.
-- ============================================================


-- ── Step 1: Add tenant_id column (idempotent — skips if already exists) ───────

DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN
    ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.drivers') IS NOT NULL THEN
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.bookings') IS NOT NULL THEN
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.trip_schedules') IS NOT NULL THEN
    ALTER TABLE trip_schedules ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.trip_incidents') IS NOT NULL THEN
    ALTER TABLE trip_incidents ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.bus_routes') IS NOT NULL THEN
    ALTER TABLE bus_routes ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.school_bus_schedules') IS NOT NULL THEN
    ALTER TABLE school_bus_schedules ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.school_bus_students') IS NOT NULL THEN
    ALTER TABLE school_bus_students ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.rental_agreements') IS NOT NULL THEN
    ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.damage_claims') IS NOT NULL THEN
    ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.finance_invoices') IS NOT NULL THEN
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.agent_runs') IS NOT NULL THEN
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.ambulance_calls') IS NOT NULL THEN
    ALTER TABLE ambulance_calls ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

-- Domain verification columns on tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain_verification_token  TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain_verified_at         TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain_verification_method TEXT;


-- ── Step 2: Backfill tenant_id (only confirmed columns used) ─────────────────
-- Confirmed via information_schema query on live DB:
--   vehicles        → branch_id   (confirmed)
--   finance_invoices → branch_id  (confirmed)
--   rental_agreements → open_branch_id / close_branch_id (confirmed)
--   bookings, drivers, trip_schedules → no branch column, skipped

-- vehicles via branch_id (cast both sides to text to avoid uuid=text mismatch)
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL
     AND to_regclass('public.tenant_branches') IS NOT NULL THEN
    UPDATE vehicles v
    SET tenant_id = tb.tenant_id::uuid
    FROM tenant_branches tb
    WHERE v.branch_id::text = tb.id::text
      AND v.tenant_id IS NULL;
  END IF;
END $$;

-- finance_invoices via branch_id
DO $$ BEGIN
  IF to_regclass('public.finance_invoices') IS NOT NULL
     AND to_regclass('public.tenant_branches') IS NOT NULL THEN
    UPDATE finance_invoices fi
    SET tenant_id = tb.tenant_id::uuid
    FROM tenant_branches tb
    WHERE fi.branch_id::text = tb.id::text
      AND fi.tenant_id IS NULL;
  END IF;
END $$;

-- rental_agreements via open_branch_id
DO $$ BEGIN
  IF to_regclass('public.rental_agreements') IS NOT NULL
     AND to_regclass('public.tenant_branches') IS NOT NULL THEN
    UPDATE rental_agreements ra
    SET tenant_id = tb.tenant_id::uuid
    FROM tenant_branches tb
    WHERE ra.open_branch_id::text = tb.id::text
      AND ra.tenant_id IS NULL;
  END IF;
END $$;


-- ── Step 3: Indexes on tenant_id ─────────────────────────────────────────────

DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_id ON vehicles(tenant_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.drivers') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_drivers_tenant_id ON drivers(tenant_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.bookings') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_bookings_tenant_id ON bookings(tenant_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.trip_schedules') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_trip_schedules_tenant_id ON trip_schedules(tenant_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.trip_incidents') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_trip_incidents_tenant_id ON trip_incidents(tenant_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.bus_routes') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_bus_routes_tenant_id ON bus_routes(tenant_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.school_bus_schedules') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_school_bus_schedules_tenant_id ON school_bus_schedules(tenant_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.school_bus_students') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_school_bus_students_tenant_id ON school_bus_students(tenant_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.rental_agreements') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_rental_agreements_tenant_id ON rental_agreements(tenant_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.damage_claims') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_damage_claims_tenant_id ON damage_claims(tenant_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.finance_invoices') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_finance_invoices_tenant_id ON finance_invoices(tenant_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.agent_runs') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_id ON agent_runs(tenant_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.ambulance_calls') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_ambulance_calls_tenant_id ON ambulance_calls(tenant_id);
  END IF;
END $$;


-- ── Step 4: Row Level Security ────────────────────────────────────────────────
-- Policy: allow rows where tenant_id IS NULL (legacy) OR matches session context.

DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN
    ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE vehicles FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN
    CREATE POLICY tenant_isolation ON vehicles
      USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.drivers') IS NOT NULL THEN
    ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE drivers FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.drivers') IS NOT NULL THEN
    CREATE POLICY tenant_isolation ON drivers
      USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.bookings') IS NOT NULL THEN
    ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE bookings FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.bookings') IS NOT NULL THEN
    CREATE POLICY tenant_isolation ON bookings
      USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.trip_schedules') IS NOT NULL THEN
    ALTER TABLE trip_schedules ENABLE ROW LEVEL SECURITY;
    ALTER TABLE trip_schedules FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.trip_schedules') IS NOT NULL THEN
    CREATE POLICY tenant_isolation ON trip_schedules
      USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.trip_incidents') IS NOT NULL THEN
    ALTER TABLE trip_incidents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE trip_incidents FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.trip_incidents') IS NOT NULL THEN
    CREATE POLICY tenant_isolation ON trip_incidents
      USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.bus_routes') IS NOT NULL THEN
    ALTER TABLE bus_routes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE bus_routes FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.bus_routes') IS NOT NULL THEN
    CREATE POLICY tenant_isolation ON bus_routes
      USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.school_bus_schedules') IS NOT NULL THEN
    ALTER TABLE school_bus_schedules ENABLE ROW LEVEL SECURITY;
    ALTER TABLE school_bus_schedules FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.school_bus_schedules') IS NOT NULL THEN
    CREATE POLICY tenant_isolation ON school_bus_schedules
      USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.school_bus_students') IS NOT NULL THEN
    ALTER TABLE school_bus_students ENABLE ROW LEVEL SECURITY;
    ALTER TABLE school_bus_students FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.school_bus_students') IS NOT NULL THEN
    CREATE POLICY tenant_isolation ON school_bus_students
      USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.rental_agreements') IS NOT NULL THEN
    ALTER TABLE rental_agreements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE rental_agreements FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.rental_agreements') IS NOT NULL THEN
    CREATE POLICY tenant_isolation ON rental_agreements
      USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.damage_claims') IS NOT NULL THEN
    ALTER TABLE damage_claims ENABLE ROW LEVEL SECURITY;
    ALTER TABLE damage_claims FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.damage_claims') IS NOT NULL THEN
    CREATE POLICY tenant_isolation ON damage_claims
      USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.finance_invoices') IS NOT NULL THEN
    ALTER TABLE finance_invoices ENABLE ROW LEVEL SECURITY;
    ALTER TABLE finance_invoices FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.finance_invoices') IS NOT NULL THEN
    CREATE POLICY tenant_isolation ON finance_invoices
      USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.agent_runs') IS NOT NULL THEN
    ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.agent_runs') IS NOT NULL THEN
    CREATE POLICY tenant_isolation ON agent_runs
      USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.ambulance_calls') IS NOT NULL THEN
    ALTER TABLE ambulance_calls ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ambulance_calls FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ambulance_calls') IS NOT NULL THEN
    CREATE POLICY tenant_isolation ON ambulance_calls
      USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── Step 5: Helper function ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_tenant_context(tid TEXT)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.tenant_id', tid, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── Verify ────────────────────────────────────────────────────────────────────
-- After running, confirm RLS is enabled with:
--
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- AND tablename IN ('vehicles','drivers','bookings','trip_schedules',
--                   'finance_invoices','rental_agreements','damage_claims');
