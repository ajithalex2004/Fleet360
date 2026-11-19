-- Sync missing columns (trip_logs), cast boarding_events.method to enum,
-- and update enforce_trip_schedule_status_transition() to recognize full dual vocabulary
-- (SCHEDULED, STARTED, IN_PROGRESS, EN_ROUTE, DEPARTED, IN_TRANSIT, COMPLETED, AUTO_CLOSED, CANCELLED).

ALTER TABLE "public"."trip_logs"
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'boarding_events'
      AND column_name = 'method'
      AND udt_name <> 'boarding_event_source'
  ) THEN
    ALTER TABLE "public"."boarding_events"
      ALTER COLUMN "method" TYPE "public"."boarding_event_source"
      USING ("method"::text::"public"."boarding_event_source");
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_trip_schedule_status_transition()
RETURNS TRIGGER AS $$
DECLARE
  allowed TEXT[];
  from_status TEXT;
  to_status   TEXT;
BEGIN
  from_status := OLD.status;
  to_status   := NEW.status;

  IF from_status IS NULL OR to_status IS NULL THEN
    RETURN NEW;
  END IF;

  IF from_status = to_status THEN
    RETURN NEW;
  END IF;

  allowed := CASE from_status
    WHEN 'SCHEDULED'   THEN ARRAY['DEPARTED', 'STARTED', 'IN_PROGRESS', 'CANCELLED']
    WHEN 'DEPARTED'    THEN ARRAY['IN_TRANSIT', 'EN_ROUTE', 'COMPLETED', 'AUTO_CLOSED', 'CANCELLED']
    WHEN 'STARTED'     THEN ARRAY['IN_TRANSIT', 'EN_ROUTE', 'COMPLETED', 'AUTO_CLOSED', 'CANCELLED']
    WHEN 'IN_PROGRESS' THEN ARRAY['IN_TRANSIT', 'EN_ROUTE', 'COMPLETED', 'AUTO_CLOSED', 'CANCELLED']
    WHEN 'IN_TRANSIT'  THEN ARRAY['COMPLETED', 'AUTO_CLOSED', 'CANCELLED']
    WHEN 'EN_ROUTE'    THEN ARRAY['COMPLETED', 'AUTO_CLOSED', 'CANCELLED']
    WHEN 'COMPLETED'   THEN ARRAY[]::TEXT[]
    WHEN 'AUTO_CLOSED' THEN ARRAY[]::TEXT[]
    WHEN 'CANCELLED'   THEN ARRAY[]::TEXT[]
    ELSE NULL
  END;

  IF allowed IS NULL THEN
    RAISE EXCEPTION 'Unknown TripSchedule.status from=% (allowed map has no entry)', from_status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (to_status = ANY(allowed)) THEN
    RAISE EXCEPTION 'Illegal TripSchedule status transition %->% (allowed from %: %)',
      from_status, to_status, from_status, array_to_string(allowed, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
