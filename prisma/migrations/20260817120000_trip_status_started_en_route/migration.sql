-- Rename trip_schedules status values for product language:
--   DEPARTED   → STARTED
--   IN_TRANSIT → EN_ROUTE
-- Status is stored as text (not a Postgres enum) on trip_schedules.

UPDATE trip_schedules
SET status = 'STARTED', updated_at = NOW()
WHERE status = 'DEPARTED';

UPDATE trip_schedules
SET status = 'EN_ROUTE', updated_at = NOW()
WHERE status = 'IN_TRANSIT';

-- Any denormalized copies on related tables (best-effort)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trip_logs' AND column_name = 'status'
  ) THEN
    EXECUTE $u$UPDATE trip_logs SET status = 'STARTED' WHERE status = 'DEPARTED'$u$;
    EXECUTE $u$UPDATE trip_logs SET status = 'EN_ROUTE' WHERE status = 'IN_TRANSIT'$u$;
  END IF;
END $$;
