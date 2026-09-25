-- Row-level security for the tenant tables that had none.
--
-- A read-only check of production (scripts/security/verify-db-identity.mjs,
-- 2026-09-25) found 22 tables with a tenant_id column and RLS disabled
-- (10 of them on staging). The runtime role fleet360_app can therefore read
-- and write every tenant's rows in them; only each query's own tenant filter
-- stood in the way, and the WhatsApp message routes had none: every tenant
-- could list and resolve every other tenant's WhatsApp conversations.
--
-- Several of these tables are not created by any migration (the AI agent
-- tables are created at runtime by src/lib/agents/schema.ts, the document
-- intelligence and enterprise tables outside the repository), so each table
-- is skipped when it does not exist. That keeps fresh installs and staging
-- working; the tables are covered wherever they exist.
--
-- For each table:
--   - drop every existing policy. RLS was disabled, so none was ever in
--     effect, and a leftover permissive policy would OR-widen the new one;
--   - ENABLE and FORCE row level security (FORCE: the owner is not exempt);
--   - one tenant_isolation policy in the project's standard form: the
--     platform context ('*', withPlatformAdmin) or the row's tenant equal to
--     app.tenant_id, for reads and for writes (WITH CHECK). There is no
--     tenant_id IS NULL escape: rows without a tenant, and the runtime
--     tables' 'default' tenant, are visible in platform context only.
--
-- Code that touches these tables outside an authenticated request now runs
-- in an explicit tenant or platform context (event consumers, partner-driver
-- links, WhatsApp and Twilio webhooks, the document lifecycle sweep).

DO $$
DECLARE
  tbl  text;
  rel  regclass;
  pol  record;
  col_type text;
  tenant_expr text;
  tbls text[] := ARRAY[
    'ai.agent_anomaly_flags',
    'finance.finance_payables',
    'public.agent_approvals',
    'public.agent_evaluation_metrics',
    'public.agent_roi_metrics',
    'public.bus_ops_demand_forecasts',
    'public.bus_ops_plan_recommendations',
    'public.contract_clauses_index',
    'public.demand_forecasts',
    'public.document_batch_jobs',
    'public.document_feedback_records',
    'public.document_intelligence_extractions',
    'public.enterprise_connections',
    'public.enterprise_sync_logs',
    'public.outsource_awards',
    'public.outsource_requests',
    'public.partner_invoices',
    'public.preventive_maintenance_forecasts',
    'public.purchase_orders',
    'public.tenant_ai_policies',
    'public.toll_transactions',
    'public.whatsapp_messages'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    rel := to_regclass(tbl);
    IF rel IS NULL THEN
      RAISE NOTICE 'rls: % does not exist here, skipped', tbl;
      CONTINUE;
    END IF;

    SELECT format_type(a.atttypid, a.atttypmod) INTO col_type
      FROM pg_attribute a
     WHERE a.attrelid = rel AND a.attname = 'tenant_id' AND NOT a.attisdropped;
    IF col_type IS NULL THEN
      RAISE NOTICE 'rls: % has no tenant_id column, skipped', tbl;
      CONTINUE;
    END IF;

    -- text columns compare directly; any other type (uuid) is compared as
    -- text so the '*' platform value never has to be cast to the column type.
    tenant_expr := CASE WHEN col_type IN ('text', 'character varying')
                        THEN 'tenant_id'
                        ELSE 'tenant_id::text' END;

    FOR pol IN SELECT policyname FROM pg_policies
                WHERE schemaname = split_part(tbl, '.', 1)
                  AND tablename  = split_part(tbl, '.', 2) LOOP
      EXECUTE format('DROP POLICY %I ON %s', pol.policyname, rel);
    END LOOP;

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO fleet360_app', rel);
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %s FOR ALL '
      'USING (current_setting(''app.tenant_id'', true) = ''*'' OR %s = current_setting(''app.tenant_id'', true)) '
      'WITH CHECK (current_setting(''app.tenant_id'', true) = ''*'' OR %s = current_setting(''app.tenant_id'', true))',
      rel, tenant_expr, tenant_expr
    );
  END LOOP;
END $$;
