-- Fresh-DB-replay consistency fix for trip_schedules / trip_stop_visits RLS.
--
-- Both tables already have ENABLE + FORCE ROW LEVEL SECURITY and a correct
-- tenant_isolation policy on every live environment (inherited from the
-- unversioned, pre-tracked tenant_isolation.sql ops script, then tightened
-- by 20260910000000_remove_null_tenant_escape). Verified directly against
-- the live database before writing this migration:
--
--   trip_schedules   : rls_enabled=true, rls_forced=true,
--                       USING ((tenant_id)::text = current_setting('app.tenant_id', true) OR ... = '*')
--   trip_stop_visits : rls_enabled=true, rls_forced=true,
--                       USING (tenant_id = current_setting('app.tenant_id', true) OR ... = '*')
--
-- There is no live gap. But 20260910000000 only REBUILDS a policy that
-- already carries the NULL-tenant branch (`IF polnames IS NOT NULL`) — it
-- never creates one from scratch. A genuinely fresh database, which never
-- ran the untracked legacy script, hits ENABLE + FORCE with zero policies
-- defined: deny-all, not a leak, but a divergence from every real
-- environment and a silent breakage of every bus-ops trip/stop query. This
-- closes that gap the same way 20260914010000 closed it for the untracked
-- domain schemas: idempotent, safe to run against a database that already
-- has the correct policy (drops and recreates an identical one) or one that
-- has none at all.
--
-- trip_schedules.tenant_id is uuid; trip_stop_visits.tenant_id is text — the
-- policy expression is generated per column type, same approach as
-- 20260910000000.

DO $$
DECLARE
  t       text;
  coltype text;
  expr    text;
  targets text[] := ARRAY['trip_schedules', 'trip_stop_visits'];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'SKIP % — does not exist', t;
      CONTINUE;
    END IF;

    SELECT data_type INTO coltype
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id';

    IF coltype = 'uuid' THEN
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR ((tenant_id)::text = current_setting(''app.tenant_id'', true))';
    ELSE
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL USING (%s) WITH CHECK (%s)',
      t, expr, expr
    );

    RAISE NOTICE 'ensured RLS + tenant_isolation policy on %', t;
  END LOOP;
END $$;
