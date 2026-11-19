-- Grant DML privileges to runtime roles fleet360_app and fleet360_api_role
-- on the tables created by 20261117040000 and 20261117041500.

DO $$
DECLARE
  v_tbl TEXT;
  v_tables TEXT[] := ARRAY[
    'bus_route_variants',
    'bus_route_variant_versions',
    'alert_rules',
    'bus_ops_schedule_templates',
    'transport_calendars',
    'transport_calendar_entries',
    'stripe_events_processed',
    'planning_constraints'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', v_tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_api_role', v_tbl);
    END IF;
  END LOOP;
END $$;
