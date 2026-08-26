-- fleet.bus_gps_pings and operations.incidents: close the nullable escape.
--
-- These two were invisible to every audit in this series until
-- scripts/check-rls-effective.mjs stopped deriving its schema list from
-- search_path and started discovering EVERY non-system schema containing a
-- tenant_id column.
--
-- That distinction matters. search_path here is `"$user", public, finance, ai`.
-- Four more schemas exist and are not on it:
--
--   fleet       bus_gps_pings
--   operations  incidents
--   spatial     places
--   workforce   driver_performance, employees
--
-- A checker keyed to search_path finds none of them. Being off search_path
-- makes a table harder for the application to reach; it does not make its rows
-- unreadable to a connection that names the schema, and it certainly does not
-- make RLS unnecessary.
--
-- Both tables are empty, so this is the same cheap operation as
-- 20260910000000: tenant_id SET NOT NULL and the `tenant_id IS NULL` branch
-- dropped from both halves of the policy. operations.incidents has a uuid
-- tenant_id and compares (tenant_id)::text; fleet.bus_gps_pings is text.
--
-- A CORRECTION THIS FORCES on 20260906000000, which reads:
--
--     NOT covered: incidents.incident_no. TripIncident maps to public.incidents,
--     which does not exist in this database — the endpoint fails with 42P01
--     before it can reach a uniqueness problem.
--
-- The endpoint does fail with 42P01, but not for that reason. The table exists,
-- as operations.incidents. It is unreachable because `operations` is absent
-- from search_path, so to_regclass('incidents') returns null. The distinction
-- changes the fix: schema-qualify the query or extend search_path, rather than
-- create a table that is already there. The sequence-number work that migration
-- described is still not applicable here and is not attempted.
--
-- Idempotent.

DO $$
DECLARE
  i       int;
  sch     text;
  tbl     text;
  coltype text;
  nulls   bigint;
  expr    text;
  pn      text;
  targets text[][] := ARRAY[
    ARRAY['fleet',      'bus_gps_pings'],
    ARRAY['operations', 'incidents']
  ];
BEGIN
  FOR i IN 1 .. array_length(targets, 1) LOOP
    sch := targets[i][1];
    tbl := targets[i][2];

    IF to_regclass(quote_ident(sch) || '.' || quote_ident(tbl)) IS NULL THEN
      RAISE NOTICE 'SKIP %.% — does not exist', sch, tbl;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM %I.%I WHERE tenant_id IS NULL', sch, tbl) INTO nulls;
    IF nulls > 0 THEN
      RAISE NOTICE 'SKIP %.% — % NULL-tenant row(s) appeared since this was written', sch, tbl, nulls;
      CONTINUE;
    END IF;

    SELECT data_type INTO coltype FROM information_schema.columns
     WHERE table_schema = sch AND table_name = tbl AND column_name = 'tenant_id';

    IF coltype = 'uuid' THEN
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR ((tenant_id)::text = current_setting(''app.tenant_id'', true))';
    ELSE
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
    END IF;

    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN tenant_id SET NOT NULL', sch, tbl);

    FOR pn IN
      SELECT pol.polname FROM pg_policy pol
        JOIN pg_class c ON c.oid = pol.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = sch AND c.relname = tbl
         AND pol.polcmd = '*' AND pol.polpermissive
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pn, sch, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR ALL USING (%s) WITH CHECK (%s)',
        pn, sch, tbl, expr, expr);
    END LOOP;

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', sch, tbl);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', sch, tbl);

    RAISE NOTICE 'tightened %.% (tenant_id %)', sch, tbl, coltype;
  END LOOP;
END $$;

-- Verify across EVERY non-system schema, not a hardcoded list — the same
-- mistake this migration exists to correct.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col
      ON col.table_schema = n.nspname AND col.table_name = c.relname
     AND col.column_name = 'tenant_id'
   WHERE c.relkind = 'r'
     AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg_%'
     AND col.is_nullable = 'YES'
     AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
                  AND pg_get_expr(p.polqual, p.polrelid) LIKE '%tenant_id IS NULL%')
     -- The documented holds: two global-reference models and two rows-of-unknown
     -- provenance. Everything else must be closed.
     AND (n.nspname || '.' || c.relname) NOT IN (
       'public.roles', 'finance.finance_tax_categories',
       'public.bookings', 'public.customer_hierarchy'
     );

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'verification failed: live NULL escape outside the documented holds: %', bad;
  END IF;
END $$;
