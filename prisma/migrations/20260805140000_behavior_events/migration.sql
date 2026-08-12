-- Migration: 20260805140000_behavior_events
--
-- Table for the behaviour watcher: a real-time driver-behaviour
-- scoring system that samples GPS at 1Hz during a trip and flags
-- harsh events (harsh brake, harsh accel, speeding, idle).
--
-- Events are written by the mobile app's offline sync queue, so
-- the table is mostly append-only. The shift_id / trip_id columns
-- are optional because the watcher may run outside of a specific
-- shift context (e.g. the dev affordance "simulate drive" button).
--
-- Score is not stored — it's computed on the fly from this table.
-- start_at (100) - Σ(deductions) is the formula, with deductions:
--   5  per HARSH_BRAKE
--   5  per HARSH_ACCEL
--   2  per IDLE_START (per minute the idle lasts, derived from
--        IDLE_START/IDLE_END duration in the page)
--   0.5 per km/h over the route max, integrated over time
--
-- The (tenant_id, driver_id, occurred_at) index supports the
-- typical "show me last 7 days for this driver" query without a
-- full table scan.
--
-- Applied via docs/apply_behavior_events_migration.py.

CREATE TABLE IF NOT EXISTS behavior_events (
  id            UUID        PRIMARY KEY,
  tenant_id     UUID        NOT NULL,
  driver_id     UUID        NOT NULL,
  shift_id      UUID,
  trip_id       UUID,
  -- HARSH_BRAKE | HARSH_ACCEL | SPEEDING | IDLE_START | IDLE_END
  -- (matches the CbaRuleCategory-style enum pattern used elsewhere)
  type          TEXT        NOT NULL
                CHECK (type IN ('HARSH_BRAKE', 'HARSH_ACCEL', 'SPEEDING', 'IDLE_START', 'IDLE_END')),
  -- The numeric value associated with the event. The unit depends
  -- on the type:
  --   HARSH_BRAKE / HARSH_ACCEL : km/h/s (decel/accel magnitude)
  --   SPEEDING                  : km/h over the limit
  --   IDLE_START / IDLE_END     : null (the duration is computed
  --                                from the pair of timestamps)
  value         NUMERIC(6, 2),
  speed_kph     NUMERIC(6, 2),
  location_lat  NUMERIC(9, 6),
  location_lng  NUMERIC(9, 6),
  -- Optional free-form note. e.g. for IDLE_START: "traffic light at
  -- Sheikh Zayed Rd / Al Wasl Rd". For SPEEDING: the limit in km/h.
  note          TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS behavior_events_tenant_driver_time_idx
  ON behavior_events (tenant_id, driver_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS behavior_events_trip_idx
  ON behavior_events (tenant_id, trip_id, occurred_at)
  WHERE trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS behavior_events_shift_idx
  ON behavior_events (tenant_id, shift_id, occurred_at)
  WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS behavior_events_type_idx
  ON behavior_events (tenant_id, type);
