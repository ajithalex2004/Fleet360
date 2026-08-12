-- Task: retire ensureBusGpsTables() lazy helper — Architectural risk #3
--
-- Moves the DDL that was hidden inside src/lib/bus-gps.ts's
-- ensureBusGpsTables() into a proper migration so a fresh env has
-- the tables without relying on a runtime CREATE-on-first-request.
--
-- Covers:
--   - fleet.bus_gps_pings + its two indexes (already handled by
--     move_bus_gps_pings_to_fleet.sql; included here idempotently)
--   - trip_stop_visits — geofence-derived per-stop visit rows
--     (approached_at / entered_at / left_at + notify idempotency)
--   - route_stops.geofence_radius_m column (per-stop radius override
--     against the default 100m in DEFAULT_ARRIVAL_RADIUS_M)
--
-- After this migration lands the ensureBusGpsTables() helper is deleted
-- from src/lib/bus-gps.ts + its two callers.

-- bus_gps_pings — already in fleet after move_bus_gps_pings_to_fleet.sql,
-- but idempotent CREATE IF NOT EXISTS + indexes for envs that apply
-- these files out of order.
CREATE TABLE IF NOT EXISTS fleet.bus_gps_pings (
  id            TEXT PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  tenant_id     TEXT,
  vehicle_id    TEXT NOT NULL,
  schedule_id   TEXT,
  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,
  speed_kmh     DOUBLE PRECISION,
  heading_deg   DOUBLE PRECISION,
  accuracy_m    DOUBLE PRECISION,
  occurred_at   TIMESTAMPTZ NOT NULL,
  source        TEXT
);
CREATE INDEX IF NOT EXISTS idx_bus_gps_pings_schedule_occurred
  ON fleet.bus_gps_pings (schedule_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_bus_gps_pings_vehicle_occurred
  ON fleet.bus_gps_pings (vehicle_id, occurred_at);

-- Per-stop visit state (upserted by the geofence evaluator).
CREATE TABLE IF NOT EXISTS trip_stop_visits (
  id                    TEXT        PRIMARY KEY,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ,
  tenant_id             TEXT,
  schedule_id           TEXT        NOT NULL,
  stop_id               TEXT        NOT NULL,
  approached_at         TIMESTAMPTZ,
  entered_at            TIMESTAMPTZ,
  left_at               TIMESTAMPTZ,
  approach_notified_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_trip_stop_visit
  ON trip_stop_visits (schedule_id, stop_id);

-- Per-stop geofence radius override (nullable — falls back to the
-- DEFAULT_ARRIVAL_RADIUS_M constant in src/lib/bus-gps.ts).
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER;
