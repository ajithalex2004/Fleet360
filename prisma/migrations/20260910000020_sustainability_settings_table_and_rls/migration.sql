-- Move runtime DDL out of src/app/api/sustainability/settings into a real
-- migration. sustainability/dashboard/route.ts also had an ensureTables()
-- that created a DIFFERENT, incompatible sustainability_settings schema
-- (baseline_pct/reporting_std/base_year/grid_factor vs this file's 11
-- unrelated columns) plus a sustainability_snapshots table — confirmed by
-- reading the whole file that its GET handler never reads or writes
-- either table. That DDL was dead code and is deleted from the route
-- rather than migrated; nothing else in the codebase references
-- sustainability_snapshots. settings/route.ts's schema below is the one
-- actually read and written, so it is the canonical definition.

CREATE TABLE IF NOT EXISTS sustainability_settings (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                         TEXT NOT NULL DEFAULT 'default',
  org_name                          TEXT DEFAULT '',
  baseline_year                     INTEGER DEFAULT 2023,
  baseline_routing_improvement      NUMERIC(5,4) DEFAULT 0.20,
  private_car_km_assumption         NUMERIC(6,2) DEFAULT 18.0,
  private_car_ef_kg_per_km          NUMERIC(8,4) DEFAULT 0.1700,
  diesel_ef_kg_per_litre            NUMERIC(8,4) DEFAULT 2.6800,
  petrol_ef_kg_per_litre            NUMERIC(8,4) DEFAULT 2.3100,
  uae_grid_ef_kg_per_kwh            NUMERIC(8,4) DEFAULT 0.4570,
  ev_km_per_kwh                     NUMERIC(6,2) DEFAULT 6.50,
  school_bus_avg_occupancy_target   NUMERIC(5,2) DEFAULT 75.0,
  reporting_currency                TEXT DEFAULT 'AED',
  vat_rate                          NUMERIC(5,4) DEFAULT 0.05,
  created_at                        TIMESTAMPTZ DEFAULT NOW(),
  updated_at                        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);
-- If dashboard/route.ts's other definition (id/tenant_id/baseline_pct/
-- reporting_std/base_year/grid_factor/notes) won the race on some
-- database, the CREATE TABLE above no-ops against it. Add every column
-- settings/route.ts actually reads and writes so its queries work
-- regardless of which variant is currently live.
ALTER TABLE sustainability_settings ADD COLUMN IF NOT EXISTS org_name TEXT DEFAULT '';
ALTER TABLE sustainability_settings ADD COLUMN IF NOT EXISTS baseline_year INTEGER DEFAULT 2023;
ALTER TABLE sustainability_settings ADD COLUMN IF NOT EXISTS baseline_routing_improvement NUMERIC(5,4) DEFAULT 0.20;
ALTER TABLE sustainability_settings ADD COLUMN IF NOT EXISTS private_car_km_assumption NUMERIC(6,2) DEFAULT 18.0;
ALTER TABLE sustainability_settings ADD COLUMN IF NOT EXISTS private_car_ef_kg_per_km NUMERIC(8,4) DEFAULT 0.1700;
ALTER TABLE sustainability_settings ADD COLUMN IF NOT EXISTS diesel_ef_kg_per_litre NUMERIC(8,4) DEFAULT 2.6800;
ALTER TABLE sustainability_settings ADD COLUMN IF NOT EXISTS petrol_ef_kg_per_litre NUMERIC(8,4) DEFAULT 2.3100;
ALTER TABLE sustainability_settings ADD COLUMN IF NOT EXISTS uae_grid_ef_kg_per_kwh NUMERIC(8,4) DEFAULT 0.4570;
ALTER TABLE sustainability_settings ADD COLUMN IF NOT EXISTS ev_km_per_kwh NUMERIC(6,2) DEFAULT 6.50;
ALTER TABLE sustainability_settings ADD COLUMN IF NOT EXISTS school_bus_avg_occupancy_target NUMERIC(5,2) DEFAULT 75.0;
ALTER TABLE sustainability_settings ADD COLUMN IF NOT EXISTS reporting_currency TEXT DEFAULT 'AED';
ALTER TABLE sustainability_settings ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,4) DEFAULT 0.05;
ALTER TABLE sustainability_settings ADD COLUMN IF NOT EXISTS tenant_id TEXT;
-- dashboard/route.ts's variant allowed tenant_id to be NULL/absent a
-- default; backfill any such rows to 'default' so the UNIQUE(tenant_id)
-- and NOT NULL below can apply uniformly.
UPDATE sustainability_settings SET tenant_id = 'default' WHERE tenant_id IS NULL;
ALTER TABLE sustainability_settings ALTER COLUMN tenant_id SET DEFAULT 'default';

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'sustainability_settings']
  ];
  i int;
  sch text;
  tbl text;
BEGIN
  FOR i IN 1 .. array_length(targets, 1) LOOP
    sch := targets[i][1];
    tbl := targets[i][2];

    IF to_regclass(quote_ident(sch) || '.' || quote_ident(tbl)) IS NULL THEN
      RAISE NOTICE 'SKIP %.% — does not exist', sch, tbl;
      CONTINUE;
    END IF;

    SELECT data_type, is_nullable INTO coltype, nullable
      FROM information_schema.columns
     WHERE table_schema = sch AND table_name = tbl AND column_name = 'tenant_id';

    IF coltype IS NULL THEN
      RAISE NOTICE 'SKIP %.% — no tenant_id column', sch, tbl;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM %I.%I WHERE tenant_id IS NULL', sch, tbl) INTO nulls;

    IF nullable = 'YES' AND nulls = 0 THEN
      EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN tenant_id SET NOT NULL', sch, tbl);
    ELSIF nulls > 0 THEN
      RAISE NOTICE '%.% has % NULL-tenant row(s) — column left nullable, rows become platform-only', sch, tbl, nulls;
    END IF;

    IF coltype = 'uuid' THEN
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR ((tenant_id)::text = current_setting(''app.tenant_id'', true))';
    ELSE
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', sch, tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I FOR ALL USING (%s) WITH CHECK (%s)',
      sch, tbl, expr, expr);

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', sch, tbl);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', sch, tbl);

    done := done + 1;
    RAISE NOTICE 'RLS enabled on %.% (tenant_id %, % rows had NULL)', sch, tbl, coltype, nulls;
  END LOOP;

  RAISE NOTICE 'enabled RLS on % of % tables', done, array_length(targets, 1);
END $$;
