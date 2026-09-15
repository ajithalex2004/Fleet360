-- Closes the "20260910000004" row from issue #77's audit.
--
-- 20260910000004_enable_rls_seven_tables is already applied on every real
-- environment and is left untouched, same approach as every migration in
-- this series. Its 7-table targeted loop is already fully defensive
-- (skips missing tables/columns) and all 7 are genuinely tracked
-- elsewhere in history — this isn't a missing-table problem.
--
-- It fails on a fresh replay because of its OWN closing verification, not
-- the 7-table loop: a hard check that every tenant-owned table across
-- public/finance/ai has RLS + a policy, RIGHT NOW. That's inherently
-- order-dependent on every other RLS-enabling migration in the whole
-- history, most of which are dated after this one and haven't run yet at
-- this point on any fresh replay — 26 tables' worth on a genuinely fresh
-- run, none of them related to what this migration actually does. On live
-- it silently passed because every tenant-owned table already had RLS
-- from the untracked legacy path, from the very start — a fresh replay
-- gets there incrementally instead. Same reasoning as omitting
-- 20260910000000's own closing verification for the same reason.
--
-- Reproduces only the real, self-contained part: the 7-table loop,
-- verbatim. No global verification here — it would need to run after
-- every other RLS gap in this repository's history is closed, which this
-- migration cannot guarantee and was never really asserting in the first
-- place (it happened to be true on live by accident of history, not by
-- anything this migration's 7-table loop actually establishes).
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260910000004_enable_rls_seven_tables

DO $$
DECLARE
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
    RAISE NOTICE 'RLS ensured on %.% (tenant_id %, % rows had NULL)', sch, tbl, coltype, nulls;
  END LOOP;

  RAISE NOTICE 'ensured RLS on % of % tables', done, array_length(targets, 1);
END $$;
