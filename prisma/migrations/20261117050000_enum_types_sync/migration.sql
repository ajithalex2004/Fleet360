-- Additive sync for enum types declared in prisma/schema.prisma
-- (boarding_event_source and trip_passenger_status) so local/fresh replay matches Neon.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'boarding_event_source' AND n.nspname = 'public') THEN
    CREATE TYPE public.boarding_event_source AS ENUM ('BLE', 'QR', 'NFC', 'MANUAL', 'DRIVER_APP', 'GEOFENCE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'trip_passenger_status' AND n.nspname = 'public') THEN
    CREATE TYPE public.trip_passenger_status AS ENUM ('CONFIRMED', 'ABSENT', 'BOARDED', 'ALIGHTED', 'NO_SHOW', 'CANCELLED', 'WAITLISTED');
  END IF;
END $$;
