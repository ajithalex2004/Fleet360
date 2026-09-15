-- Closes the "20260910000000" row from issue #77's audit.
--
-- 20260910000000_remove_null_tenant_escape is already applied on every
-- real environment and is left untouched, same approach as every
-- migration in this series. Its 44-table loop already guards against a
-- table not existing (`to_regclass(...) IS NULL THEN CONTINUE`), but not
-- against the table existing without a tenant_id column yet — the same
-- 20260914140000/20260914150000 (#73/#74/#78) ordering gap seen elsewhere,
-- here hitting damage_claims (and potentially others in the 44, on a
-- fresh replay run before this fix exists). Verbatim re-run of the same
-- loop, with one added guard (column existence, alongside the table
-- existence it already had) and the same closing verification. Safe
-- no-op on every real environment, where all 44 already have the column
-- and are already tightened.

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

    -- The one addition over the original: column-existence guard.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) THEN
      skipped := skipped || (t || ' (no tenant_id column yet)');
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', t) INTO nulls;
    IF nulls > 0 THEN
      skipped := skipped || (t || ' (' || nulls || ' NULL-tenant rows appeared)');
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

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', t);

    SELECT array_agg(pol.polname ORDER BY pol.polname) INTO polnames
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t
       AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%tenant_id IS NULL%'
       AND pol.polcmd = '*' AND pol.polpermissive;

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
    ELSE
      -- Original migration only ever rebuilt a policy that already carried
      -- the NULL branch. On a fresh replay reaching this far, some of
      -- these 44 tables may have no policy at all yet (created by a
      -- migration later than this one originally, whose own RLS section
      -- never ran because IT also hit an ordering gap). Ensure one exists
      -- with the tightened expression either way — matches what #73/#75/
      -- #76's fixes already do for their own tables, applied uniformly
      -- here rather than leaving a silent gap.
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I FOR ALL USING (%s) WITH CHECK (%s)',
        t, expr, expr);
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    tightened := tightened + 1;
  END LOOP;

  RAISE NOTICE 'NULL-tenant escape ensured on % of % tables', tightened, array_length(targets, 1);
  IF array_length(skipped, 1) > 0 THEN
    RAISE NOTICE 'skipped: %', array_to_string(skipped, '; ');
  END IF;
END $$;
