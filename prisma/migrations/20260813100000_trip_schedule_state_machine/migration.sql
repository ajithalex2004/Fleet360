-- R6 fix 2026-08-13 — DB-level guard for TripSchedule status transitions
--
-- Why this trigger exists:
--   Postgres enums on trip_schedules.status enforce the VOCABULARY
--   (which values are valid) but nothing at the DB layer stops an
--   illegal *transition* (e.g. SCHEDULED → COMPLETED, which would
--   skip no-show marking and the audit trail). The application
--   code in src/lib/bus-ops/state-machines.ts has the canonical
--   transition table and assertTripTransition() — but any UPDATE
--   that bypasses the helper (raw SQL, a forgotten call site, a
--   future migration that forgets the rule) would silently corrupt
--   the audit chain.
--
-- The trigger below mirrors the app-layer rules. It runs in the
-- same transaction as the UPDATE, so an illegal transition is
-- rejected with a clear error before commit. The error message
-- names the from/to/allowed triple so failures are debuggable
-- from server logs.
--
-- This is defense-in-depth, not a replacement. The application
-- still calls assertTripTransition() in every PATCH so the error
-- is caught close to the user with a 409 + helpful message. The
-- trigger is the last line of defense.

CREATE OR REPLACE FUNCTION enforce_trip_schedule_status_transition()
RETURNS TRIGGER AS $$
DECLARE
  allowed TEXT[];
  from_status TEXT;
  to_status   TEXT;
BEGIN
  from_status := OLD.status;
  to_status   := NEW.status;

  -- Only fire on actual status changes; allow NULL→anything and
  -- anything→NULL (those are not state transitions).
  IF from_status IS NULL OR to_status IS NULL THEN
    RETURN NEW;
  END IF;

  -- No-op transitions are allowed (idempotent PATCHes).
  IF from_status = to_status THEN
    RETURN NEW;
  END IF;

  -- Canonical transition table. Mirror of
  -- src/lib/bus-ops/state-machines.ts TRIP_TRANSITIONS.
  -- If you add a new status or transition, update BOTH.
  allowed := CASE from_status
    WHEN 'SCHEDULED'  THEN ARRAY['DEPARTED', 'CANCELLED']
    WHEN 'DEPARTED'   THEN ARRAY['IN_TRANSIT', 'COMPLETED', 'CANCELLED']
    WHEN 'IN_TRANSIT' THEN ARRAY['COMPLETED', 'CANCELLED']
    WHEN 'COMPLETED'  THEN ARRAY[]::TEXT[]
    WHEN 'CANCELLED'  THEN ARRAY[]::TEXT[]
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

DROP TRIGGER IF EXISTS trip_schedule_status_transition_guard ON trip_schedules;
CREATE TRIGGER trip_schedule_status_transition_guard
  BEFORE UPDATE OF status ON trip_schedules
  FOR EACH ROW
  EXECUTE FUNCTION enforce_trip_schedule_status_transition();
