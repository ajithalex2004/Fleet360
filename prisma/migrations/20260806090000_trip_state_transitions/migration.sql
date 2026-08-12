-- Migration: trip state transitions
-- Driver-only trip lifecycle: the driver taps Start, the trip moves
-- SCHEDULED -> IN_PROGRESS and we stamp actual_departure_at. The
-- driver taps End, the trip moves IN_PROGRESS -> COMPLETED and we
-- stamp actual_arrival_at. Every transition is recorded in
-- trip_state_transitions for an immutable audit trail.
--
-- Columns on trip_schedules are denormalized projections of the
-- latest transition — they exist so the trip-card UI and the CBA
-- engine can do simple WHERE clauses without joining the log.

-- 1) New columns on trip_schedules
ALTER TABLE trip_schedules
  ADD COLUMN IF NOT EXISTS actual_departure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_arrival_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_by_driver_id UUID,
  ADD COLUMN IF NOT EXISTS ended_by_driver_id   UUID,
  ADD COLUMN IF NOT EXISTS start_location       JSONB,
  ADD COLUMN IF NOT EXISTS end_location         JSONB,
  ADD COLUMN IF NOT EXISTS late_minutes         INT,
  ADD COLUMN IF NOT EXISTS duration_minutes     INT;

CREATE INDEX IF NOT EXISTS trip_schedules_actual_departure_idx
  ON trip_schedules (tenant_id, actual_departure_at DESC);
CREATE INDEX IF NOT EXISTS trip_schedules_late_minutes_idx
  ON trip_schedules (tenant_id, late_minutes)
  WHERE late_minutes IS NOT NULL;

-- 2) The audit log. One row per state change. The source column
-- distinguishes DRIVER_APP / DISPATCHER / ADMIN / SYSTEM so we can
-- tell who initiated the change.
CREATE TABLE IF NOT EXISTS trip_state_transitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  trip_id         TEXT NOT NULL,  -- text to match trip_schedules.id
  driver_id       UUID,           -- nullable: dispatcher transitions have no driver
  transition      TEXT NOT NULL CHECK (transition IN (
                    'SCHEDULED',  -- recorded on creation or re-schedule
                    'STARTED',    -- driver tapped Start
                    'COMPLETED',  -- driver tapped End
                    'CANCELLED',  -- dispatcher or driver cancelled
                    'RESTARTED',  -- driver re-started a completed trip
                    'AUTO_CLOSED' -- system cron closed a stale IN_PROGRESS
                  )),
  at              TIMESTAMPTZ NOT NULL,
  location        JSONB,          -- {lat, lng, accuracyM}
  source          TEXT NOT NULL,  -- 'DRIVER_APP' | 'DISPATCHER' | 'ADMIN' | 'SYSTEM'
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trip_state_transitions_trip_idx
  ON trip_state_transitions (trip_id, at DESC);
CREATE INDEX IF NOT EXISTS trip_state_transitions_tenant_driver_idx
  ON trip_state_transitions (tenant_id, driver_id, at DESC);
CREATE INDEX IF NOT EXISTS trip_state_transitions_tenant_at_idx
  ON trip_state_transitions (tenant_id, at DESC);
