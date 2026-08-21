-- Rename MaintenanceStatus: REPAIR_COMPLETED → JOB_COMPLETED
--                    READY_FOR_SERVICE → READY_FOR_OPERATION
-- Postgres cannot RENAME enum values portably; add new values then backfill.

ALTER TYPE "public"."MaintenanceStatus" ADD VALUE IF NOT EXISTS 'JOB_COMPLETED';
ALTER TYPE "public"."MaintenanceStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_OPERATION';

-- Backfill existing rows (only if columns still store old labels)
UPDATE maintenance_requests
SET status = 'JOB_COMPLETED'
WHERE status::text = 'REPAIR_COMPLETED';

UPDATE maintenance_requests
SET status = 'READY_FOR_OPERATION'
WHERE status::text = 'READY_FOR_SERVICE';

-- History / timeline tables if they store status as text or enum
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'histories' AND column_name = 'status'
  ) THEN
    UPDATE histories SET status = 'JOB_COMPLETED' WHERE status = 'REPAIR_COMPLETED';
    UPDATE histories SET status = 'READY_FOR_OPERATION' WHERE status = 'READY_FOR_SERVICE';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'histories status backfill skipped: %', SQLERRM;
END $$;

-- Note: old enum labels REPAIR_COMPLETED / READY_FOR_SERVICE remain on the type
-- until a full enum rebuild; app code must use the new labels only.
