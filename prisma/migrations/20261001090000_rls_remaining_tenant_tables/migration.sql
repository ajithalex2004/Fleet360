-- Row-level security for the remaining tenant tables.
--
-- The security harness (scripts/security-harness, database phase) found 55
-- tables with a tenant_id column and row level security disabled on a fresh
-- install: the logistics tables, the event outbox and consumer inbox, the
-- driver app tables (DVIR, fuel and expense entries, shifts, trip state
-- transitions, WebAuthn credentials), the service configuration tables and
-- others. The runtime role could read and write every tenant's rows in them;
-- only each query's own tenant filter stood in the way. Five of them
-- (maintenance_plans, pm_schedule_items, quality_inspections,
-- vehicle_warranties, warranty_claims) already had a policy that was never
-- in effect because RLS was not enabled.
--
-- Production may already have RLS on some of these (enabled outside the
-- migrations in August 2026); this migration is idempotent and brings every
-- environment to the same state. A table that does not exist is skipped.
--
-- For each table:
--   - drop every existing policy, so a leftover permissive policy cannot
--     OR-widen the new one;
--   - grant the runtime role fleet360_app its usual privileges;
--   - ENABLE and FORCE row level security (FORCE: the owner is not exempt);
--   - one tenant_isolation policy in the project's standard form: the
--     platform context ('*', withPlatformAdmin) or the row's tenant equal to
--     app.tenant_id, for reads and for writes (WITH CHECK). Rows without a
--     tenant are visible in platform context only.
--
-- One exception: finance.finance_tax_categories holds the shared UAE VAT
-- categories with tenant_id NULL. Every tenant may read them (a separate
-- SELECT policy); only the platform context may change them. A tenant's own
-- categories carry its tenant_id (src/app/api/finance/tax/route.ts).
--
-- Code that touches these tables outside an authenticated request runs in
-- an explicit tenant or platform context: the Go /logistics and /dispatch
-- groups (auth.TenantTx), the outbox publishers, the auto-close-trips job,
-- the carrier portal invite flows and the shipper portal.

DO $$
DECLARE
  tbl  text;
  rel  regclass;
  pol  record;
  col_type text;
  tenant_expr text;
  tbls text[] := ARRAY[
    'finance.finance_tax_categories',
    'public.behavior_events',
    'public.driver_reports',
    'public.dvir',
    'public.dvir_photos',
    'public.event_consumer_inbox',
    'public.event_outbox',
    'public.expense_entries',
    'public.expense_entry_photos',
    'public.fuel_entries',
    'public.fuel_entry_photos',
    'public.incidents',
    'public.logistics_accessorial_catalog',
    'public.logistics_assignments',
    'public.logistics_cargo_lines',
    'public.logistics_carrier_bids',
    'public.logistics_carrier_documents',
    'public.logistics_carrier_portal_invites',
    'public.logistics_carrier_scorecards',
    'public.logistics_carrier_settlements',
    'public.logistics_carrier_vehicles',
    'public.logistics_carriers',
    'public.logistics_change_history',
    'public.logistics_consignments',
    'public.logistics_customer_marketplace_settings',
    'public.logistics_driver_payouts',
    'public.logistics_finance_postings',
    'public.logistics_freight_charges',
    'public.logistics_freight_rfqs',
    'public.logistics_master_data',
    'public.logistics_pod_events',
    'public.logistics_rate_contracts',
    'public.logistics_route_legs',
    'public.logistics_shift_handovers',
    'public.logistics_shipment_exceptions',
    'public.logistics_shipment_orders',
    'public.logistics_shipment_stops',
    'public.logistics_shipping_requests',
    'public.logistics_telematics_events',
    'public.logistics_tracking_events',
    'public.maintenance_plans',
    'public.partner_scorecards',
    'public.pm_schedule_items',
    'public.quality_inspections',
    'public.service_categories',
    'public.service_scopes',
    'public.service_types',
    'public.shifts',
    'public.tenant_branches',
    'public.transport_calendar',
    'public.transport_requests',
    'public.trip_state_transitions',
    'public.vehicle_warranties',
    'public.warranty_claims',
    'public.webauthn_credentials'
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

    IF tbl = 'finance.finance_tax_categories' THEN
      EXECUTE format(
        'CREATE POLICY shared_categories_read ON %s FOR SELECT USING (tenant_id IS NULL)',
        rel
      );
    END IF;
  END LOOP;
END $$;
