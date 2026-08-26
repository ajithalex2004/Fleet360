-- Turn RLS ON for seven tenant-owned tables that never had it.
--
-- Three were already known:
--
--   public.WorkOrder                              text, NOT NULL, 0 rows
--   public.bulk_import_jobs                       uuid, NOT NULL, 3 rows, 1 tenant
--   public.route_consolidation_scoring_policies    text, NOT NULL, 1 row,  1 tenant
--
-- Four were NOT known, and the reason they were missed matters more than the
-- tables themselves: scripts/check-rls-effective.mjs hardcoded schema 'public'.
-- An unqualified table name resolves against the whole search_path — here
-- `"$user", public, finance, ai` — so a checker that inspects one schema is not
-- inspecting what the application actually reaches. It would have reported
-- OPEN_NO_RLS = 0 while these sat wide open:
--
--   finance.finance_bank_accounts     text, nullable, 0 rows
--   finance.finance_collection_cases  text, nullable, 0 rows
--   finance.finance_pdc_cheques       text, nullable, 0 rows
--   finance.finance_expenses          text, nullable, 3 rows — ALL tenant_id NULL
--
-- The checker is fixed in the same change; it now scans every schema on
-- search_path and reports 266 tenant-owned tables rather than 254.
--
-- Every table gets the tightened canonical policy — no `tenant_id IS NULL`
-- branch, for the reasons in 20260910000000 — in both USING and WITH CHECK,
-- plus ENABLE and FORCE.
--
-- finance_expenses is the one exception to SET NOT NULL. Its 3 rows have no
-- tenant and there is no attribution path, so the column stays nullable and
-- those rows are simply not guessed at. Note what enabling RLS does for them:
-- because the policy has no IS NULL branch, they stop being visible to any
-- tenant and remain reachable only under withPlatformAdmin. That is strictly
-- safer than today, where the table has no RLS at all and every row is readable
-- by anyone. Unlike auth_login_attempts, WITH CHECK does NOT permit NULL here —
-- an expense without a tenant is debt, not a legitimate state, so new ones are
-- rejected while the existing three await provenance.
--
-- Idempotent.

DO $$
DECLARE
  rec       record;
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public',  'WorkOrder'],
    ARRAY['public',  'bulk_import_jobs'],
    ARRAY['public',  'route_consolidation_scoring_policies'],
    ARRAY['finance', 'finance_bank_accounts'],
    ARRAY['finance', 'finance_collection_cases'],
    ARRAY['finance', 'finance_expenses'],
    ARRAY['finance', 'finance_pdc_cheques']
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

    -- Constrain the column only where there is nothing to guess about.
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

    -- Replace any pre-existing policy of the same name rather than assuming
    -- there is none; these tables report zero today but the migration should
    -- be re-runnable.
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

-- Verify in-transaction: no tenant-owned table on search_path may be left
-- without RLS and a policy.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'finance', 'ai')
     AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema = n.nspname AND col.table_name = c.relname
                    AND col.column_name = 'tenant_id')
     AND (NOT c.relrowsecurity
          OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid));

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'verification failed: tenant-owned tables still without RLS or a policy: %', bad;
  END IF;
END $$;
