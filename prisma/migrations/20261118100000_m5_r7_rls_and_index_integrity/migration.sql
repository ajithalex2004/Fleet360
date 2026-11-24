-- M5-R7 WP1 & WP2: RLS hardening, DB identity alignment, and tenant-scoped unique index reconciliation
-- Idempotent and non-destructive (uses DROP POLICY IF EXISTS / DROP INDEX IF EXISTS only).

-- 1. public.platform_subscription_invoices: enable + force RLS, tenant_isolation, and tenant-scoped unique index
ALTER TABLE IF EXISTS public.platform_subscription_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.platform_subscription_invoices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.platform_subscription_invoices;
CREATE POLICY tenant_isolation ON public.platform_subscription_invoices FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true)));

DROP INDEX IF EXISTS public.platform_subscription_invoices_invoice_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_subscription_invoices_tenant_no
  ON public.platform_subscription_invoices (tenant_id, invoice_number);

-- 2. finance.finance_payments: tighten nullable tenant_id (when 0 NULL rows) and drop IS NULL from policy
DO $$
DECLARE
  nulls bigint;
  expr  text := '(current_setting(''app.tenant_id'', true) = ''*'')'
             || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
  pol   record;
BEGIN
  IF to_regclass('finance.finance_payments') IS NOT NULL THEN
    SELECT count(*) INTO nulls FROM finance.finance_payments WHERE tenant_id IS NULL;
    IF nulls = 0 THEN
      ALTER TABLE finance.finance_payments ALTER COLUMN tenant_id SET NOT NULL;
    END IF;
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'finance' AND tablename = 'finance_payments' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON finance.finance_payments', pol.policyname);
    END LOOP;
    EXECUTE format('CREATE POLICY tenant_isolation ON finance.finance_payments FOR ALL USING (%s) WITH CHECK (%s)', expr, expr);
    ALTER TABLE finance.finance_payments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE finance.finance_payments FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- 3. Shared-read + tenant-write tables: finance.finance_tax_categories, public.email_templates, public.vehicle_types
DO $$
DECLARE
  tbl  text;
  rel  regclass;
  pol  record;
  sel  text := '(tenant_id IS NULL) OR (current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true))';
  rw   text := '(current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true))';
  tbls text[] := ARRAY['finance.finance_tax_categories', 'public.email_templates', 'public.vehicle_types'];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    rel := to_regclass(tbl);
    IF rel IS NULL THEN CONTINUE; END IF;
    FOR pol IN SELECT policyname FROM pg_policies
                WHERE schemaname = split_part(tbl, '.', 1) AND tablename = split_part(tbl, '.', 2) LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %s', pol.policyname, rel);
    END LOOP;
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %s FOR SELECT USING (%s)', rel, sel);
    EXECUTE format('CREATE POLICY tenant_isolation_insert ON %s FOR INSERT WITH CHECK (%s)', rel, rw);
    EXECUTE format('CREATE POLICY tenant_isolation_update ON %s FOR UPDATE USING (%s) WITH CHECK (%s)', rel, rw, rw);
    EXECUTE format('CREATE POLICY tenant_isolation_delete ON %s FOR DELETE USING (%s)', rel, rw);
  END LOOP;
END $$;

-- 4. public.session_revocations: shared user-wide SELECT + platform-only INSERT/UPDATE + explicit DENY DELETE
DO $$
DECLARE
  pol record;
  sel text := '(tenant_id IS NULL) OR (current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true))';
  rw  text := '(current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true))';
BEGIN
  IF to_regclass('public.session_revocations') IS NOT NULL THEN
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'session_revocations' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.session_revocations', pol.policyname);
    END LOOP;
    ALTER TABLE public.session_revocations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.session_revocations FORCE ROW LEVEL SECURITY;
    EXECUTE format('CREATE POLICY session_revocations_select ON public.session_revocations FOR SELECT USING (%s)', sel);
    EXECUTE format('CREATE POLICY session_revocations_insert ON public.session_revocations FOR INSERT WITH CHECK (%s)', rw);
    CREATE POLICY session_revocations_insert_platform_only ON public.session_revocations AS RESTRICTIVE FOR INSERT
      WITH CHECK (current_setting('app.tenant_id', true) = '*');
    EXECUTE format('CREATE POLICY session_revocations_update ON public.session_revocations FOR UPDATE USING (%s) WITH CHECK (%s)', rw, rw);
    CREATE POLICY session_revocations_update_platform_only ON public.session_revocations AS RESTRICTIVE FOR UPDATE
      USING (current_setting('app.tenant_id', true) = '*')
      WITH CHECK (current_setting('app.tenant_id', true) = '*');
    CREATE POLICY session_revocations_no_deletes ON public.session_revocations FOR DELETE USING (false);
  END IF;
END $$;

-- 5. Defense-in-depth: FORCE ROW LEVEL SECURITY on remaining RLS-enabled tables
ALTER TABLE IF EXISTS public.logistics_document_sequences FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transport_enrollments FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS workforce.driver_performance FORCE ROW LEVEL SECURITY;
