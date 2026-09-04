-- Move runtime DDL out of src/app/api/admin/{dispatch-stats,nav-permissions,platform-settings}
-- into a real migration, and turn on RLS for the two tables that already
-- carry a tenant_id column but never had a policy (dispatch_jobs,
-- driver_availability — see the code comment in dispatch-stats/route.ts).
--
-- platform_settings is a global key/value table with no tenant_id by
-- design (feature flags, SMTP config, etc.) — no RLS applies to it.
--
-- All CREATE TABLE / INDEX statements are transcribed verbatim from the
-- ensureTable()/ensureTables() functions being deleted from those routes,
-- so this is a no-op on a database where the tables already exist.

CREATE TABLE IF NOT EXISTS dispatch_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  service_type TEXT NOT NULL DEFAULT 'PASSENGER',
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  status TEXT NOT NULL DEFAULT 'PENDING',
  assigned_driver_id TEXT,
  assigned_vehicle_id TEXT,
  current_attempt INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_availability (
  driver_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  vehicle_id TEXT,
  zone_id TEXT,
  service_types JSONB NOT NULL DEFAULT '["PASSENGER"]',
  shift_starts_at TIMESTAMPTZ,
  shift_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_admin_nav_permissions (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  nav_key    TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, nav_key)
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Enable RLS on the tenant-owned tables above ─────────────────────────────
-- Same canonical, idempotent pattern as 20260910000004_enable_rls_seven_tables:
-- SET NOT NULL only where safe, tightened policy (no tenant_id IS NULL branch),
-- ENABLE + FORCE RLS. Re-runnable.

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'dispatch_jobs'],
    ARRAY['public', 'driver_availability'],
    ARRAY['public', 'tenant_admin_nav_permissions']
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
