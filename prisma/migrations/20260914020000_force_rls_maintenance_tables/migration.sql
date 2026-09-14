-- Closes an RLS gap found during the Second-Tenant Onboarding / Enterprise
-- Multi-Tenant Readiness audit: maintenance_plans, pm_schedule_items,
-- quality_inspections, vehicle_warranties, and warranty_claims already had
-- ENABLE ROW LEVEL SECURITY + a tenant_isolation policy (from the 2026-08-03
-- broad sweep), but never FORCE ROW LEVEL SECURITY. Since the application
-- connects as fleet360_app (not the table owner, neondb_owner), the policy
-- was already being enforced for real traffic — FORCE closes the remaining
-- gap where any future connection as the owner role would silently bypass
-- it, and brings these five in line with every other tenant-scoped table in
-- this schema, all of which use FORCE.
--
-- Also tightens the policy: tenant_id is NOT NULL on all five tables (was
-- already true before this migration), so the inherited "tenant_id IS NULL"
-- escape branch from the original 2026-08-03 sweep is dead code. Removed for
-- the same reason 20260910000008/20260910000000 removed it elsewhere.
--
-- maintenance_plans/pm_schedule_items were additionally unsafe to force
-- until now: src/lib/agents/preventive-maintenance/agent.ts queried both
-- (plus vehicles) via the bare, unscoped prisma client, which set no
-- app.tenant_id — forcing RLS without fixing that first would have made the
-- agent's PM forecasting silently see zero plans for every tenant. Fixed
-- separately in the same change as this migration.

DO $$
DECLARE
  tbl text;
  targets text[] := ARRAY[
    'maintenance_plans', 'pm_schedule_items', 'quality_inspections',
    'vehicle_warranties', 'warranty_claims'
  ];
BEGIN
  FOREACH tbl IN ARRAY targets LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE NOTICE 'SKIP % — does not exist', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true))
         WITH CHECK (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true))',
      tbl
    );

    RAISE NOTICE 'forced RLS + tightened policy on %', tbl;
  END LOOP;
END $$;
