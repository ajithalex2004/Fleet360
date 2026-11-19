-- Additive alignment for trip_passengers.status enum type (TripPassengerStatus -> trip_passenger_status)
-- and DML grants to runtime roles on remaining application tables.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trip_passengers'
      AND column_name = 'status'
      AND udt_name = 'TripPassengerStatus'
  ) THEN
    ALTER TABLE public.trip_passengers
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE public.trip_passenger_status USING status::text::public.trip_passenger_status,
      ALTER COLUMN status SET DEFAULT 'CONFIRMED'::public.trip_passenger_status;
  END IF;
END $$;

DO $$
DECLARE
  v_tbl TEXT;
  v_tables TEXT[] := ARRAY[
    'bus_gateway_ingest_receipts',
    'trip_stop_visits',
    'bus_rider_notification_rules',
    'bus_rider_deliveries',
    'bus_trip_disruptions',
    'platform_subscription_invoices'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', v_tbl);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_api_role', v_tbl);
      END IF;
    END IF;
  END LOOP;
END $$;
