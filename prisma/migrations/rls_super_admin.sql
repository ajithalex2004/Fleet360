-- ============================================================
-- RLS upgrade — '*' wildcard for SUPER_ADMIN cross-tenant queries.
-- Idempotent: drops + recreates each policy so multiple runs are safe.
--
-- Pairs with src/lib/rls.ts:
--   withTenantRls(prisma, tenantId, fn)  → SET app.tenant_id = '<id>'
--   withSuperAdminRls(prisma, fn)        → SET app.tenant_id = '*'
-- ============================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vehicles','drivers','bookings','trip_schedules','trip_incidents',
    'bus_routes','school_bus_schedules','school_bus_students',
    'rental_agreements','damage_claims','finance_invoices',
    'agent_runs','ambulance_calls'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I '
        || 'USING (tenant_id IS NULL '
        ||        'OR current_setting(''app.tenant_id'', true) = ''*'' '
        ||        'OR tenant_id::text = current_setting(''app.tenant_id'', true))',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_clause
-- FROM pg_policy
-- WHERE polname = 'tenant_isolation';
