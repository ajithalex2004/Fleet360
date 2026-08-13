-- Architectural risk #3 — extend the tenant-isolation RLS pattern
-- introduced in 20260803000000_rls_tenant_isolation_all_tables to:
--
-- (a) the new domain schemas workforce / fleet / operations
--     (introduced this branch — the original migration only scanned
--     `public`)
-- (b) new public-schema tables created after 2026-08-03 that carry a
--     tenant_id column (transport_calendars, transport_enrollments,
--     route_passengers, bus_ops_geofences, bus_ops_vehicle_positions,
--     bus_ops_schedule_templates)
--
-- Policy shape MUST match the original exactly — do not tighten
-- without coordinating with the withSuperAdminRls() helper in
-- src/lib/rls.ts, which sets app.tenant_id = '*' to bypass:
--
--   USING (
--     tenant_id IS NULL
--     OR current_setting('app.tenant_id', true) = '*'
--     OR tenant_id::text = current_setting('app.tenant_id', true)
--   )
--
-- Idempotent — CREATE POLICY IF NOT EXISTS + ALTER TABLE ENABLE RLS is
-- guarded so re-runs produce the same end state.

-- Index the tenant_id column on every applicable table across our 4
-- managed schemas (public + 3 new domain schemas).
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tbl
      ON tbl.table_schema = c.table_schema AND tbl.table_name = c.table_name
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema IN ('public','workforce','fleet','operations')
      AND tbl.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%I_tenant_id ON %I.%I(tenant_id)',
      t.table_name, t.table_schema, t.table_name
    );
  END LOOP;
END $$;

-- Enable RLS and attach the tenant-isolation policy.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tbl
      ON tbl.table_schema = c.table_schema AND tbl.table_name = c.table_name
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema IN ('public','workforce','fleet','operations')
      AND tbl.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.table_schema, t.table_name);
    -- Drop then recreate so we always land on the exact policy shape
    -- (guards against drift if someone hand-edited a prior version).
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', t.table_schema, t.table_name);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I.%I
      USING (
        tenant_id IS NULL
        OR current_setting('app.tenant_id', true) = '*'
        OR tenant_id::text = current_setting('app.tenant_id', true)
      )
      WITH CHECK (
        tenant_id IS NULL
        OR current_setting('app.tenant_id', true) = '*'
        OR tenant_id::text = current_setting('app.tenant_id', true)
      )
    $p$, t.table_schema, t.table_name);
  END LOOP;
END $$;

-- workforce.driver_performance has no tenant_id column (scope inherited
-- via driver_id FK → public.drivers.tenant_id). Same FK-relay pattern
-- as transport_calendar_entries below.
ALTER TABLE workforce.driver_performance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_via_driver ON workforce.driver_performance;
CREATE POLICY tenant_isolation_via_driver ON workforce.driver_performance
  USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_id
        AND (
          d.tenant_id IS NULL
          OR current_setting('app.tenant_id', true) = '*'
          OR d.tenant_id::text = current_setting('app.tenant_id', true)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_id
        AND (
          d.tenant_id IS NULL
          OR current_setting('app.tenant_id', true) = '*'
          OR d.tenant_id::text = current_setting('app.tenant_id', true)
        )
    )
  );

-- transport_calendar_entries has no tenant_id of its own (scope
-- inherited via calendar_id FK). Enable RLS with a policy that resolves
-- through the parent so a foreign-tenant caller can't read/write
-- entries even if they know a calendar_id.
ALTER TABLE transport_calendar_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_via_calendar ON transport_calendar_entries;
CREATE POLICY tenant_isolation_via_calendar ON transport_calendar_entries
  USING (
    EXISTS (
      SELECT 1 FROM transport_calendars c
      WHERE c.id = calendar_id
        AND (
          c.tenant_id IS NULL
          OR current_setting('app.tenant_id', true) = '*'
          OR c.tenant_id::text = current_setting('app.tenant_id', true)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM transport_calendars c
      WHERE c.id = calendar_id
        AND (
          c.tenant_id IS NULL
          OR current_setting('app.tenant_id', true) = '*'
          OR c.tenant_id::text = current_setting('app.tenant_id', true)
        )
    )
  );
