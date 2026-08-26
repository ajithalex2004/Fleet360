-- Close the nullable-tenant escape on 44 tables that do not use it.
--
-- The canonical policy in src/lib/rls.ts opens with a NULL branch:
--
--     USING (
--       tenant_id IS NULL
--       OR current_setting('app.tenant_id', true) = '*'
--       OR tenant_id = current_setting('app.tenant_id', true)
--     )
--
-- That first branch means a row written WITHOUT a tenant is visible to EVERY
-- tenant, and RLS will not stop it because the policy explicitly permits it.
-- The policy is correctly implemented; the data model is what leaks. Switching
-- the runtime role to fleet360_app does not close this — the escape survives
-- the switch untouched, and nothing errors, so an activation pass will not
-- surface it either.
--
-- 254 tables carry tenant_id. 205 have this escape. On 155 of them tenant_id is
-- already NOT NULL, so the branch is unreachable and harmless. On 50 it is
-- nullable and the escape is live.
--
-- This migration handles the 44 of those 50 that hold no NULL-tenant rows at
-- all. Empty of NULLs is the cheapest possible moment: no backfill, no data to
-- mis-assign, and nothing to decide about existing rows.
--
-- The other 6 are deliberately NOT in this list:
--
--   roles                 11 rows. NULL is load-bearing BY DESIGN — 10 of the
--                         11 are is_system=true platform role templates, and
--                         src/app/api/admin/session/route.ts grants '*:*:*' on
--                         exactly `role.code = 'SUPER_ADMIN' AND
--                         role.tenantId === null`. Removing this would break
--                         super-admin. Keep and document.
--   route_stops           34 rows, recoverable from the parent route.
--   trip_logs              4 rows, recoverable from the parent schedule.
--                         Both handled in 20260910000001.
--   auth_login_attempts  124 rows. 118 have user_id IS NULL — genuinely
--                         unattributable failed logins, so NULL has a real
--                         reason. But the escape publishes 12 email addresses,
--                         IPs, user agents and lockout state to every tenant.
--                         Needs a design decision (sentinel tenant, or
--                         platform-admin-only reads), not a backfill.
--   bookings               3 rows, 0 of 3 recoverable from vehicle_id.
--   customer_hierarchy     3 rows, self-referencing FK only, no path to a
--                         tenant. Both need someone who knows whether these
--                         are test rows.
--
-- WHAT THIS DOES, per table:
--
--   1. Refuses to touch the table if any NULL-tenant row has appeared since
--      this was written. A skip is louder than a half-applied migration.
--   2. ALTER COLUMN tenant_id SET NOT NULL.
--   3. Rebuilds every policy whose USING carries the NULL branch, dropping
--      that branch and keeping the rest. Only FOR ALL permissive policies are
--      rebuilt; anything else raises a notice and is left alone rather than
--      being silently rewritten.
--   4. FORCE ROW LEVEL SECURITY. Four of these tables have RLS enabled but not
--      forced (customer_interactions, dvir_defects, trip_stop_visits,
--      vehicle_issue_reports). FORCE binds the table OWNER, so it has no effect
--      on fleet360_app, which will not own these tables — it matters for
--      anything run as neondb_owner, which is where migrations and admin
--      scripts live.
--
-- Note that 4 tables carry TWO permissive policies each — cba_rule_sets,
-- headway_rules, push_subscriptions and staff_transport_plans. Permissive
-- policies combine with OR, so fixing only the one named tenant_isolation
-- would have left the escape fully open through the second. Both are rebuilt.
--
-- 45 of the 50 have a text tenant_id and 5 are uuid; the uuid ones compare
-- (tenant_id)::text, so the replacement expression is generated per column
-- type rather than hardcoded.
--
-- Idempotent: a second run finds no policy carrying the NULL branch and does
-- nothing.

DO $$
DECLARE
  t           text;
  coltype     text;
  expr        text;
  nulls       bigint;
  polnames    text[];
  pn          text;
  skipped     text[] := ARRAY[]::text[];
  tightened   int := 0;
  targets     text[] := ARRAY[
    'admin_approval_requests', 'admin_change_history', 'admin_mfa_policies',
    'audit_events', 'ble_gateway_presence', 'boarding_events',
    'bus_pretrip_checks', 'bus_route_types', 'bus_routes', 'cba_rule_sets',
    'customer_interactions', 'damage_claims', 'dispatch_weights',
    'dvir_defects', 'finance_cash_allocations', 'finance_cash_receipts',
    'finance_ct_adjustments', 'finance_ct_returns', 'finance_fiscal_years',
    'finance_periods', 'finance_receipt_vouchers', 'finance_security_deposits',
    'headway_rules', 'pricing_rules', 'push_subscriptions', 'rate_events',
    'rental_agreements', 'rental_ancillaries', 'rental_bookings',
    'rental_customers', 'rental_invoices', 'rental_rate_quotes',
    'report_schedules', 'role_versions', 'school_bus_students',
    'staff_ble_tags', 'staff_transport_plans', 'staff_transport_requests',
    'sustainability_settings', 'sustainability_snapshots', 'trip_schedules',
    'trip_stop_visits', 'vat_returns', 'vehicle_issue_reports'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP

    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      skipped := skipped || (t || ' (table does not exist)');
      CONTINUE;
    END IF;

    -- 1. Guard. This migration is only safe while the table holds no
    --    NULL-tenant rows; if any appeared, SET NOT NULL would fail and take
    --    the whole DO block with it. Skipping is the better failure.
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', t) INTO nulls;
    IF nulls > 0 THEN
      skipped := skipped || (t || ' (' || nulls || ' NULL-tenant rows appeared)');
      CONTINUE;
    END IF;

    SELECT data_type INTO coltype
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id';

    -- 2. The replacement expression: canonical policy minus the NULL branch.
    IF coltype = 'uuid' THEN
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR ((tenant_id)::text = current_setting(''app.tenant_id'', true))';
    ELSE
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
    END IF;

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', t);

    -- 3. Collect the policy names FIRST. Iterating pg_policy while dropping
    --    from it inside the loop is not something to rely on.
    SELECT array_agg(pol.polname ORDER BY pol.polname) INTO polnames
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t
       AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%tenant_id IS NULL%'
       AND pol.polcmd = '*' AND pol.polpermissive;

    -- Anything carrying the NULL branch that is NOT a FOR ALL permissive
    -- policy is left alone and reported. Rewriting a shape this migration was
    -- not written for is exactly the silent-change failure mode being removed.
    IF EXISTS (
      SELECT 1 FROM pg_policy pol
        JOIN pg_class c ON c.oid = pol.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = t
         AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%tenant_id IS NULL%'
         AND NOT (pol.polcmd = '*' AND pol.polpermissive)
    ) THEN
      RAISE NOTICE '% has a NULL-escape policy that is not FOR ALL permissive — left unchanged, review it', t;
    END IF;

    IF polnames IS NOT NULL THEN
      FOREACH pn IN ARRAY polnames LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pn, t);
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR ALL USING (%s) WITH CHECK (%s)',
          pn, t, expr, expr);
      END LOOP;
    END IF;

    -- 4. Both, always. ENABLE is already set on all of these; FORCE is not.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    tightened := tightened + 1;
  END LOOP;

  RAISE NOTICE 'NULL-tenant escape removed from % of % tables', tightened, array_length(targets, 1);
  IF array_length(skipped, 1) > 0 THEN
    RAISE NOTICE 'skipped: %', array_to_string(skipped, '; ');
  END IF;
END $$;

-- Verification in the same transaction. If any targeted table still admits a
-- NULL tenant, or still carries the escape, this fails and rolls the whole
-- migration back. A migration that claims to close a hole should not be able
-- to commit while the hole is open.
DO $$
DECLARE
  bad int;
BEGIN
  SELECT count(*) INTO bad
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col
      ON col.table_schema = 'public' AND col.table_name = c.relname
     AND col.column_name = 'tenant_id'
   WHERE n.nspname = 'public'
     AND col.is_nullable = 'YES'
     AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%tenant_id IS NULL%'
     AND c.relname <> ALL (ARRAY[
       'roles', 'route_stops', 'trip_logs',
       'auth_login_attempts', 'bookings', 'customer_hierarchy'
     ]);

  IF bad > 0 THEN
    RAISE EXCEPTION 'verification failed: % policies still carry a live NULL-tenant escape outside the 6 known exceptions', bad;
  END IF;
END $$;
